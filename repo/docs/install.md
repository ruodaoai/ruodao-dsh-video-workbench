# Universal Installation Guide — DSH Video Workbench (`v0.6.0`)

> **Original Author**: Merziller · **QQ**: `1411574209` · **WeChat**: `Merziller` · **Email**: `k26789228@gmail.com`  
> **GitHub**: https://github.com/Merziller/dsh-video-workbench (MIT Open Source)

**No longer restricted to DeepSeek Harness (DSH)!** You can install and run `dsh-video-workbench` inside **Claude Code, OpenAI Codex CLI, WorkBuddy, Cursor, Windsurf, Cline, OpenCode, Antigravity, DeepSeek Harness (DSH), or Standalone Local Browser**.

---

## One-Sentence Agent Setup Prompt
Paste this single sentence into **Claude Code / Codex CLI / WorkBuddy / Cursor / Antigravity**:
```text
Read https://github.com/Merziller/dsh-video-workbench/blob/main/docs/install.md and install & connect dsh-video-workbench MCP server + local Web Studio in my current agent.
```

---

## 1. Clone & Install Dependencies (Required for All Non-DSH Agents)
```bash
git clone https://github.com/Merziller/dsh-video-workbench.git
cd dsh-video-workbench
npm install
node ./bin/dsh-video-cli.mjs doctor
```

## 2. Connect to Your Preferred AI Agent

### A. Claude Code
```bash
claude mcp add dsh-video-workbench -- node "/absolute/path/to/dsh-video-workbench/bin/dsh-video-mcp.mjs"
```
Or open the cloned folder directly in Claude Code (`.mcp.json` and `.claude-plugin/plugin.json` are auto-detected!).

### B. OpenAI Codex CLI
Add to `~/.codex/config.toml`:
```toml
[mcp_servers.dsh_video_workbench]
command = "node"
args = ["/absolute/path/to/dsh-video-workbench/bin/dsh-video-mcp.mjs"]
```
Codex also auto-reads `AGENTS.md` and `SKILL.md`.

### C. WorkBuddy / Cursor / Windsurf / Cline / OpenCode
1. Install the universal Skill (optional, via Skills CLI):
   ```bash
   npx skills add Merziller/dsh-video-workbench
   ```
2. Add the MCP server to your agent's MCP config (or use the included `.mcp.json`):
   ```json
   {
     "mcpServers": {
       "dsh-video-workbench": {
         "command": "node",
         "args": ["/absolute/path/to/dsh-video-workbench/bin/dsh-video-mcp.mjs"]
       }
     }
   }
   ```

### D. DeepSeek Harness (DSH)
```bash
dsh plugin --profile desktop add github:Merziller/dsh-video-workbench
```
Or click **Install** from the DSH Plugin Market (`awesome-dsh-plugin`).

### E. Standalone Visual Web Studio (Zero Black Window Silent Daemon)
```bash
# Default on Windows: runs silently in background with zero black CMD window!
node ./bin/dsh-video-cli.mjs studio --open
# Or double-click `start-workbench.cmd` / `start-workbench.vbs` on Windows!
# Check status / Stop silent daemon:
node ./bin/dsh-video-cli.mjs status
node ./bin/dsh-video-cli.mjs stop   # or double-click `stop-workbench.cmd`
# Opens http://127.0.0.1:4399 in your browser: the AI Agent War Room (3 skins) with CinePulse Hub, Reference Compare, multi-track timeline, BYOK Cloud Media & Multi-Engine TTS panels!
```

**What you will see (v0.6.0 "AI Agent War Room" UI):** the studio opens straight into a native war room with three switchable skins — **C · 棱镜实验室 Prism Lab (default)**, **A · 星舰剪辑甲板 Nova Deck** and **B · 墨韵织机 Ink Loom** (skin button at the top right; your choice is remembered). Every panel (分步精修 step studio, 任务中心 tasks, 影核广场 templates, 配音中心 voices, 云端媒体中心 cloud media, 数字人 avatar, 算力体检 hardware, 设置 · 模型与密钥 settings …) is native to the skin.

First render in four clicks:
1. Top-left project button → pick a project (two demo projects are included) or 「新建工程」.
2. Click the brief box (「创意简报」 / 「创意需求」 / 「题 · 需求输入」) → write one sentence in the big editor → 「保存需求」.
3. No LLM configured yet? Open the parameter sheet (`P`) and set the creation mode (创作模式 / 模式) to 「本地极速草稿」 — it renders without any model or API key.
4. Click 「一键出片」 (`R`) and watch the agents, progress and 「实时日志」.

The full beginner guide (with the button names in all three skins) is in the README, section 「三、工作台使用指南」.

### F. Which AI model the plugin uses (it follows your agent)
By default (Settings · 模型与密钥 → 接入方式 → 「跟随当前智能体」; MCP: `configure_llm_model` with `mode: "auto"`) the plugin uses the model of the agent that runs it:
- **DeepSeek Harness** → the DSH channel currently selected in DSH.
- **Claude Code, Codex, OpenCode, OpenClaw, Hermes, pi, WorkBuddy, Antigravity, Cursor …** → the model API key in the MCP server's environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `GEMINI_API_KEY` or `OPENROUTER_API_KEY` (optionally with `*_BASE_URL` / `*_MODEL`). The provider that matches the agent is preferred (Claude Code → Anthropic, Codex → OpenAI).

Agent logins and subscriptions belong to the agent and are never read or reused. If your agent signs in with an account, or does not hand its environment to MCP servers, give the server a key yourself:
- Claude Code: `claude mcp add dsh-video-workbench -e ANTHROPIC_API_KEY=<your-api-key> -- node "/absolute/path/to/dsh-video-workbench/bin/dsh-video-mcp.mjs"`
- Codex (`~/.codex/config.toml`, under `[mcp_servers.dsh_video_workbench]`): `env = { OPENAI_API_KEY = "<your-api-key>" }`
- `.mcp.json`-style clients: add `"env": { "OPENAI_API_KEY": "<your-api-key>" }` next to `"args"`.

Or pick 「自定义（自填地址与密钥）」 in the settings and enter any OpenAI-, Anthropic-, Responses- or Gemini-compatible endpoint; the settings page always shows which agent and which model are in use. No model at all? The 「本地极速草稿」 creation mode still renders.

---

## 3. Optional Local TTS Engine Installation (IndexTTS-2.5 / IndexTTS-2 / GPT-SoVITS / Edge-TTS)
All neural TTS engines are **100% optional** — without installing any of them, you can already use **Windows Native SAPI (0GB VRAM)** or **Pure-Music Beat-Sync (`subtitle-mv`)** out of the box.

To install a local TTS engine with automatic `voices/` initialization & auto-wiring into the plugin:
- **In Web Studio**: click the **「配音」 / 「TTS」** status chip in the war-room top bar (or open **「设置 · 模型与密钥」** from the tools menu) → **「配音引擎」** tab → **「📦 一键安装依赖包」** -> choose `Edge-TTS (0GB)`, `IndexTTS-2.5 (8GB+)`, `GPT-SoVITS (4GB+)`, or `IndexTTS-2` -> click **「一键安装 … 并接入」**.
- **Via CLI**:
  ```bash
  node ./bin/dsh-video-cli.mjs install-tts --engine edge-tts --mirror cn
  node ./bin/dsh-video-cli.mjs install-tts --engine indextts25 --dir D:/AI-TTS/index-tts --mirror cn
  node ./bin/dsh-video-cli.mjs install-tts --engine gptvoice --dir D:/AI-TTS/GPT-SoVITS --mirror cn
  ```
- **Via Windows PowerShell Interactive Menu** (also downloadable as `dsh-tts-installer-pack.zip` from GitHub Releases):
  ```powershell
  powershell -ExecutionPolicy Bypass -File .\scripts\install-tts-engine.ps1
  ```
