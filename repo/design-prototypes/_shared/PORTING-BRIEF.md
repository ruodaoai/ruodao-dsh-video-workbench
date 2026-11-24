# Porting brief — prototype → production war-room skin

The user reviewed the three war-room prototypes (`design-prototypes/{nova-deck,ink-loom,prism-lab}/index.html`)
and chose **all three**: the plugin will ship them as switchable skins ("三合一，用户自由切换"). The user also
asked to **fix places where text overlaps / is covered, especially the left part (asset bay) of version A**.

Your job: turn ONE prototype into the production skin document
`packages/dsh-web-video-workbench/lib/warroom/<id>.html`, driven by the host bridge described in
`packages/dsh-web-video-workbench/lib/warroom/BRIDGE.md` (read it completely first — it is the contract).

## What stays
- The look, metaphor, layout, motion language, camera follow / pan / zoom, drawers / HUD, keyboard shortcuts,
  micro-interactions — this is what the user approved. Keep the prototype's quality; do not simplify it into a
  generic dashboard.

## What changes
1. **Data comes from the host.** Delete the inline sample project and every simulated/fake pipeline timer.
   Render only `WarRoomState` (§3 of BRIDGE.md). Re-render on every `dsh-vw/state`; animate on *transitions*
   (diff the previous and the new state: run status, `activeAgentId`, per-agent status/progress, new logs,
   assets added, staging, preview ready). Handle every state: `project === null` (onboarding: 新建工程 / 打开工程
   buttons → actions `newProject` / `openPanel {panel:'projects'}`), idle project, queued, running, paused,
   failed (red state on the failed agent + 重试), stopped, completed (preview plays `preview.mp4Url`).
2. **Every control sends an action** (§4): 一键出片 → `run` (with the topic from the brief input), 暂停/继续/停止/
   重试, parameter drawer fields → `setDirector {patch}`, AI 润色 → `polishTopic`, import button + drag&drop →
   `importFiles` (read files with `File.arrayBuffer()`, post them as transferables), asset delete → `removeAsset`,
   云端待确认 → `confirmStaging` / `discardStaging`, top-bar tabs: 分步精修 → `openPanel {panel:'studio'}`,
   影核广场 → `openPanel {panel:'plaza'}`, 任务中心 → `openPanel {panel:'tasks'}`; settings / status chips →
   `openPanel` with `llm` / `tts` / `voices` / `hardware` / `avatar` / `cloud` / `teleprompter` / `export`;
   scene click on the timeline → `openScene {sceneId}`; project title/selector → `selectProject {dir}` (list from
   `state.projects`) and 「新建」→ `newProject`; a back button → `backToChat` (only render it when `state.host === 'dsh'`).
   Tools that the prototype simulated internally (template wall, teleprompter, voice center, cloud media, brand
   kit, publish pack, reference compare, …) must not be faked anymore: route them to the host via `openPanel`.
3. **Skin switcher.** Add a compact control in the top bar that shows the three skins
   (A 星舰剪辑甲板 / B 墨韵织机 / C 棱镜实验室) and sends `setSkin {skin}`; highlight the current `state.skin`.
4. **Status chips** in the top bar from `state.status` (LLM / TTS / GPU / 口型引擎) — compact, never overflowing.
5. **Low-spec + robustness:** `state.lowSpec` → ≤ 30 fps and lighter effects; pause the loop when
   `document.hidden`; guard canvas sizes (never draw from/to a 0×0 canvas); wrap the per-frame render in
   try/catch so a bad frame can never stop the loop; clamp every computed radius/size to ≥ 0.
6. **No overlap / clipping, anywhere,** at 1100×640, 1280×720, 1440×900, 1600×900, 1920×1080 and 2560×1440, in
   every state (idle, running with camera follow active, completed, with 0 / 3 / 30 assets, 0 / 61 scenes,
   long Chinese titles). Long names: single-line ellipsis + `title`; codes/badges must never sit on top of text;
   panels must not be pushed off-screen or behind the stage by the camera follow. Fix the root cause (flex
   `min-width:0`, grid tracks, reserved space) instead of shrinking fonts below 12 px.
7. Self-contained, no network, no `eval`, file ≤ ~400 KB. Keep the `<title>` meaningful.

## Test bench
- Start your own static server on YOUR port (A 4421, B 4422, C 4423) from the worktree root:
  `cd <repo-root> && python -m http.server 442X --bind 127.0.0.1`
  (run it in the background; stop it when you are done).
- Harness: `http://127.0.0.1:442X/design-prototypes/_shared/harness.html?skin=<id>&vp=1920x1080` — control bar
  scenarios: 无工程 / 空闲工程 / ▶模拟运行 (speed 1×/3×/8×) / 暂停 / 继续 / 失败 / 停止 / 完成 / 云端待确认 /
  低配保护 / 数字人, plus an action log. Scriptable: `window.__harness.scenario('run'|'pause'|'resume'|'fail'|
  'stop'|'complete'|'idle'|'onboarding')`, `window.__harness.setSpeed(8)`, `window.__harness.state`.
- Headless screenshots: `node <tools>/page-shot.mjs <url> <outPrefix>
  --w 1920 --h 1080 --times 1500,6000 --eval "<js>@<ms>" --gpu` — ALWAYS pass `--gpu` (real GPU via D3D11; the
  default SwiftShader software mode is 4× slower and caused earlier sessions to waste hours on fake perf issues).
  Do NOT optimise for SwiftShader. Do NOT use the `mcp__Claude_Browser__*` tools (the user's browser pane is in
  use by the coordinator). The screenshot shows the harness page; the skin is the iframe below its 40 px bar.
- Overlap checker — run inside the skin document (from the harness: `document.getElementById('skinFrame')
  .contentWindow`), e.g. via `--eval`:
  ```js
  (() => { const w = document.getElementById('skinFrame').contentWindow, d = w.document
    const vis = (e) => { const s = w.getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 }
    const texts = [...d.querySelectorAll('body *')].filter((e) => vis(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
    const R = texts.map((e) => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 1 && r.height > 1)
    const bad = []
    for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
      const [a, ra] = R[i], [b, rb] = R[j]; if (a.contains(b) || b.contains(a)) continue
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
      if (ox > 2 && oy > 2) bad.push('OVERLAP ' + a.textContent.trim().slice(0, 20) + ' ⟂ ' + b.textContent.trim().slice(0, 20)) }
    for (const [e, r] of R) { const s = w.getComputedStyle(e)
      if (e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis' && s.overflowX !== 'visible') bad.push('CLIPPED ' + e.textContent.trim().slice(0, 30))
      if (r.right > w.innerWidth + 1 || r.bottom > w.innerHeight + 1 || r.left < -1) bad.push('OFFSCREEN ' + e.textContent.trim().slice(0, 30)) }
    console.log('[overlap] ' + w.innerWidth + 'x' + w.innerHeight + ' issues=' + bad.length + '\n' + bad.slice(0, 40).join('\n')) })()
  ```
  (Canvas-drawn text is invisible to it — check those labels in the screenshots and with your own geometry.)
  Run it in idle, mid-run (follow camera active) and completed states at every viewport listed in rule 6.
- Look at your screenshots with the Read tool. Target: 0 console errors, 0 overlap issues, all states correct.

## Engineering rules
- Work ONLY on `packages/dsh-web-video-workbench/lib/warroom/<id>.html` (new) and your own scratch/progress files
  in `design-prototypes/<id>/` (e.g. `PORTING-PROGRESS.md`, `shots/`). Do not edit any other file in the repo —
  other engineers are editing `client.js`, `lib/index.js`, `BRIDGE.md`, the harness, etc. If the contract needs a
  change, describe it in your final report instead of editing BRIDGE.md.
- Windows + Git Bash: heredocs mangle backslashes/backticks — write patch scripts with the Write tool and run them
  with node/python. Large edits: prefer structured scripted edits over giant Write rewrites; never truncate.
- Keep `design-prototypes/<id>/PORTING-PROGRESS.md` updated after every milestone (what is done, what is next,
  known issues) so the work can be resumed if your session is interrupted.
- Kill any headless Chrome / server you start. Never delete files you did not create. Never `rm -rf` directories.
- Do not commit to git.

## Final report (concise, Chinese is fine)
What you changed, how each WarRoomState field/transition is rendered, the action mapping, viewport/overlap results
per state, console-error count, file size, screenshots (paths), remaining limitations, and any contract change you
would propose.
