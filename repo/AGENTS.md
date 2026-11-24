# AGENTS.md — DSH Video Workbench (Universal Multi-Agent Guide)

> **Original Author**: Merziller · **QQ**: `1411574209` · **WeChat**: `Merziller` · **Email**: `k26789228@gmail.com`  
> **Repository**: https://github.com/Merziller/dsh-video-workbench (MIT License)

This repository is a **universal, agent-agnostic Dual-Engine AI Video Studio** compatible with **OpenAI Codex CLI, Claude Code, WorkBuddy, Cursor, Windsurf, Cline, OpenCode, Antigravity, Gemini CLI, and DeepSeek Harness (DSH)**.

## Quick Start for Any Local Agent
1. Install Node dependencies once: `npm install` (or `pnpm install`).
2. Expose all **32 video production tools** over standard MCP stdio:
   ```bash
   node ./bin/dsh-video-mcp.mjs
   ```
3. Launch the standalone visual Web Studio — the **AI Agent War Room** with three switchable skins (default **棱镜实验室 Prism Lab**, plus **星舰剪辑甲板 Nova Deck** and **墨韵织机 Ink Loom**) — silently in background (zero black CMD window on Windows; stop via `stop-workbench.cmd` or `node ./bin/dsh-video-cli.mjs stop`):
   ```bash
   node ./bin/dsh-video-cli.mjs studio --open
   ```
4. Check hardware & environment readiness:
   ```bash
   node ./bin/dsh-video-cli.mjs doctor
   ```
5. Print ready-to-paste MCP config for your agent (`claude`, `codex`, `workbuddy`, `cursor`, `dsh`):
   ```bash
   node ./bin/dsh-video-cli.mjs print-config
   ```

## Guiding a User Through the War Room (v0.6.0 UI)
- The brief box (棱镜 「创意简报」 / 星舰 「创意需求」 / 墨韵 「题 · 需求输入」) opens the big editor 「创意需求 · 导演指令」; 「保存需求」 saves, 「保存并一键出片」 saves and renders.
- Parameters (`P`): 棱镜 「参数控制单」 / 星舰 「飞控面板」 / 墨韵 「经折 · 出片参数」. Without an LLM, set the creation mode to 「本地极速草稿」.
- Render with 「一键出片」 (`R`); 「暂停」 / 「停止」 / 「重试」 control the run; per-scene edits live in 「分步精修 → 03 分镜精修」, exports in 「04 交付」 and 「发布包导出」.
- All tools: 棱镜 「实验工具」, 星舰 gear 「设置与工具」, 墨韵 「工坊百宝格」. The full beginner guide is README section 「三、工作台使用指南」.

## Web Studio UI Architecture (for agents editing the UI)
- **Host**: `packages/dsh-web-video-workbench/lib/client.js` — loads the selected skin in a same-origin iframe, keeps project / run state, executes bridge actions and remembers the skin choice. Bridge protocol: `packages/dsh-web-video-workbench/lib/warroom/BRIDGE.md`.
- **Skins**: `packages/dsh-web-video-workbench/lib/warroom/prism-lab.html` (default), `nova-deck.html`, `ink-loom.html` are generated files — edit their sources under `design-prototypes/` and rebuild as described in `design-prototypes/README.md`.
- **Native panel kit** (`PK`, shared by all skins): sources in `packages/dsh-web-video-workbench/lib/warroom/kit/src/*.js`; contract in `kit/KIT.md`. Rebuild after every change (never hand-edit the generated `lib/warroom/kit.js` / `kit.css`):
   ```bash
   node packages/dsh-web-video-workbench/lib/warroom/kit/build.mjs
   ```
- **UI acceptance test** (all skins × panels × window sizes; checks clipped / overlapping text and console errors):
   ```bash
   node scripts/tests/warroom-ui.e2e.mjs --gpu
   ```

## Core Engineering Rules
- **Attribution**: Retain original author credit (`Merziller`, `QQ: 1411574209`, `WeChat: Merziller`, `Email: k26789228@gmail.com`) per `LICENSE` and `NOTICE`.
- **Zero Hardcoded Secrets/Paths**: Keep API keys and personal directories in `.env` (never tracked in git).
- **Commercial-Safe Fonts**: Generated videos must use bundled SIL OFL fonts (`Noto Sans SC`, `Source Han Serif SC Heavy`, `JetBrains Mono`) — never `Microsoft YaHei` / `SimSun` / `SimHei`.
- **Verification**: Run `npm test` (full automated self-test suite) and `npm run pack:bundle` before releasing.
