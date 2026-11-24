# War-Room Skin Bridge — contract v1.1

The AI-Agent war room (作战大屏) ships three switchable skins:

| id | name | look |
|---|---|---|
| `nova-deck` | 方案 A · 星舰剪辑甲板 NOVA DECK | dark, cyan/blue sci-fi starship deck |
| `ink-loom` | 方案 B · 墨韵织机 INK LOOM | dark brown/gold Chinese ink-wash loom |
| `prism-lab` | 方案 C · 棱镜实验室 PRISM LAB | light, spectral optics lab |

棱镜实验室 (`prism-lab`) is the default skin. The legacy React "classic" war room and **all** classic React panels/modals have been
removed: every panel (分步精修, 任务中心, 影核广场, 设置 · 模型与密钥, 配音中心 …) is a **native panel inside the skin**, built from
the shared panel kit (`kit/KIT.md`, served as `kit.js` + `kit.css` next to the skins) and styled by each skin.

Each skin is ONE self-contained HTML document in this folder (`<id>.html`). The plugin serves it at
`GET /api/video-workbench/warroom/skin?id=<id>` and the React client (`../client.js`) embeds it in a same-origin
`<iframe>` that fills the war-room area. The skin owns its whole viewport (top bar, asset bay, agent stage,
task center, timeline, drawers) but **never talks to the backend itself**: the host pushes real state in and
executes every action the skin sends out. This keeps one code path for all business logic (the existing,
tested React handlers) and lets the skin stay a pure view.

## 1. Rules for a skin document

1. Self-contained: inline CSS/JS plus the shared panel kit loaded relatively (`<link rel="stylesheet" href="kit.css">`,
   `<script src="kit.js"></script>`), system fonts only, no network requests except the media URLs the host / the kit
   hands out (`<img>`, `<video>`, `<audio>` src). No `fetch`/XHR, no external CDNs, no `eval`. Backend calls go through
   the `api` / `upload` actions (§4b) — the kit wraps them.
2. Never fake business progress. Visual choreography (agents working, assets flying into the timeline, camera
   follow, waveform pulses) is driven by **state transitions** (§3). Ambient idle animation is fine.
3. Work at every viewport from **1100×640** (DSH side panel) to **2560×1440**, and at 1280/1440/1600/1920 widths
   without overlapping or clipped text: truncate with ellipsis + `title` tooltip, wrap, or collapse panels
   into drawers/HUD. Re-layout on `resize`.
4. `state.lowSpec === true`: cap rendering at 30 fps, drop heavy blur/glow/particle counts. When the document is
   hidden (`document.hidden`), stop the render loop. Guard every canvas draw against 0-sized canvases.
5. No uncaught exceptions: wrap the per-frame render in `try/catch` so one bad frame never kills the loop; log once.
6. Keyboard shortcuts only while the iframe has focus: `R` run/resume, `Space` play/pause preview, `Esc` close
   drawers. Every clickable element is a `<button>` (or has `role="button"` + `tabindex`) with an aria-label.
7. Chinese UI copy; numbers/units as in the prototypes. Keep the skin's identity (that is what the user chose).
8. Storage: only `localStorage` keys prefixed `dshvw.<skinId>.` (e.g. drawer open state). Never store state data.
9. **Never overwrite a field the user is editing.** While an `<input>`/`<textarea>`/`<select>` has focus (or was edited
   in the last ~800 ms), do not write `state.director.*` back into it — a throttled state echo can be older than the
   characters just typed. Send `setDirector` on `change`/blur (or debounced ≥ 300 ms while typing), not per keystroke.
10. **The skin is the whole UI.** The host renders nothing but the iframe (plus a neutral loading / recovery screen when the
    skin does not load). The skin renders: project title/selector, the 分步精修 / 任务中心 / 影核广场 entries, status chips, the
    skin switcher (A/B/C only), `state.busy`, `toast` events and `error` events (the kit shows those with their fix-it
    action), and opens every panel natively with `PK.open(id)`.
11. Long option lists: `options.voices` can hold 200+ entries — use a searchable / scrollable picker (or offer
    `openPanel {panel:'voices'}`), never a list that pushes the layout.

## 2. Messages

All messages are `window.postMessage(obj, '*')` objects with a `type` starting with `dsh-vw/` and `v: 1`.
The skin only accepts messages whose `event.source === window.parent`; the host only accepts messages whose
`event.source` is the skin iframe's `contentWindow`.

### skin → host

| type | payload | meaning |
|---|---|---|
| `dsh-vw/ready` | `{ skin: '<id>', v: 1 }` | sent once the DOM is ready; host answers with a full `dsh-vw/state` |
| `dsh-vw/action` | `{ id: '<unique>', action: '<name>', payload: {…} }` | user intent (§4); host answers with `dsh-vw/result` |

### host → skin

| type | payload | meaning |
|---|---|---|
| `dsh-vw/state` | `{ state: <WarRoomState> }` | full snapshot, sent on every change (throttled to ≤ 5/s) |
| `dsh-vw/result` | `{ id, ok: boolean, error?: string, data?: any }` | completion of one action |
| `dsh-vw/event` | `{ event: '<name>', data }` | one-shot cues: `toast` `{ text, level: 'info'|'success' }`, `error` `{ title, detail, action: ''|'open-llm'|'load-starter' }` (translated host error; the kit renders it), `open-panel` `{ panel, args }` (open a native panel — also the answer to legacy `openPanel` / `newProject` / `openScene` actions), `focus-agent` `{ agentId }`, `asset-added` `{ assetIds }`, `run-started` `{ runId }`, `run-finished` `{ runId, status }` |

Always tolerate unknown fields and missing optional fields (render "—" / empty states).

## 3. `WarRoomState` (v1)

```ts
interface WarRoomState {
  v: 1
  ts: number                          // Date.now() of the snapshot
  skin: 'nova-deck' | 'ink-loom' | 'prism-lab'
  host: 'dsh' | 'standalone'          // DSH desktop panel or standalone browser studio
  lowSpec: boolean
  busy: string                        // non-empty while the host is doing something modal ("正在上传 3 个文件…")

  project: null | {                   // null → show onboarding (新建 / 打开工程)
    dir: string                       // opaque id, pass back in actions
    title: string
    engine: 'remotion' | 'html'
    aspectRatio: string               // '16:9' | '9:16' | '1:1' | '3:4' | 'auto' …
    width: number; height: number; fps: number
    quality: string                   // '1080p' …
    genreLabel: string; style: string
    narrationMode: string             // 'tts' | 'tts-beat-sync' | 'subtitle-mv'
    durationSec: number               // planned/rendered total, 0 if unknown
  }
  projects: Array<{ dir: string; title: string; engine: string; updatedAt: string; hasMp4: boolean }>

  assets: Array<{
    id: string
    kind: 'image' | 'video' | 'music' | 'sfx' | 'voice' | 'host_video' | 'note' | 'other'
    name: string                      // display name (original file name)
    url: string                       // same-origin media URL ('' for notes)
    thumbUrl: string                  // image/video poster URL or ''
    durationSec: number | null
    width: number | null; height: number | null
    usedBySceneIds: string[]          // scenes whose media references this asset (drive fly-in animations)
  }>
  staging: Array<{                    // cloud results waiting for 「确认入库」
    id: string; kind: 'image' | 'video' | 'audio'
    name: string; url: string; thumbUrl: string
    provider: string; prompt: string
  }>

  run: null | {
    id: string
    status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'stopped'
    progress: number                  // 0..100
    activeAgentId: AgentId | null
    elapsedSec: number
    error: string
    errorKind?: '' | 'billing'        // 'billing' = stopped for insufficient balance; never auto-retried
    message: string                   // latest human-readable status line
  }
  agents: Array<{                     // ALWAYS these 8, in this order
    id: AgentId
    name: string                      // 策划导演 / 素材剪辑 / 配音混音 / 动效编程 / 质检渲染 / 数字人 / 云端生成 / 参考复刻
    en: string                        // DIRECTOR / EDITOR / AUDIO / MOTION CODER / QA · RENDER / AVATAR / CLOUD GEN / REFERENCE
    status: 'idle' | 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'stopped' | 'skipped'
    progress: number                  // 0..100
    message: string
  }>
  logs: Array<{ ts: string; agentId: AgentId | 'system'; level: 'info' | 'warn' | 'error'; text: string }> // newest last, ≤ 60

  timeline: {
    totalSec: number; fps: number
    bpm: number | null
    beats: Array<{ t: number; strong: boolean }>   // ≤ 600 entries
    drops: number[]                                 // climax/drop times
    scenes: Array<{
      id: string; index: number; title: string
      startSec: number; durationSec: number
      subtitle: string
      thumbUrl: string                // rendered scene thumbnail or ''
      hasVoice: boolean
      sfx: Array<{ type: string; t: number }>      // absolute seconds
      locked: boolean
    }>
    music: Array<{ name: string; startSec: number; endSec: number }>
  }

  preview: {
    mp4Url: string                    // '' if not rendered yet; same-origin, Range-capable
    posterUrl: string                 // snapshot / first thumb or ''
    hasMp4: boolean
    durationSec: number
  }

  director: {                         // the brief + parameters shown in the HUD/drawer (all editable via setDirector)
    topic: string
    engine: 'remotion' | 'html'
    creationMode: 'ai-coded' | 'fast-draft'
    aspectRatio: string; quality: string; fps: number
    durationMode: 'auto' | 'custom'; targetDurationSec: number
    narrationMode: string; bgmMode: string; pacingMode: string
    style: string                     // 'auto' (AI 自由匹配) | a preset id (emerald, tech, cinematic, documentary, energetic, warm) | 'user:<id>' (我的风格预设)
    voiceId: string
    avatarEnabled: boolean; avatarLayout: 'pip-br' | 'pip-bl' | 'fullscreen'
    // v1.1 — full brief / parameter set (all editable via setDirector)
    displayTitle: string; genre: string; genreLabel: string; directorNotes: string; contentOutline: string[]
    bgmTtsPrompt: string; targetPlatform: string; customWidth: number; customHeight: number
    aiBadgeEnabled: boolean; aiBadgePosition: string; aiBadgeText: string; visual3dMode: 'auto' | 'on' | 'off'
    useDraftReference: boolean
    visualReview: boolean             // 画面自检 (AI-coded runs: keyframes are reviewed by the model, flagged shots rewritten once)
    figureStyleChoice: 'auto' | 'silhouette' | 'papercut' | 'puppet' | 'ink' | 'flat' | 'stick' | 'custom' // 人物画风 pick
    figureStyleChoiceNote: string     // with 'custom': the character look in ≤ 40 characters (e.g. Q版萌系，圆脸大眼)
  }
  runOptions: { speechTempo: number; useHostVocal: boolean; aiAuthorCode: boolean; trimClipSec: number; clipSpeedMult: number } // v1.1, via setDirector
  avatar: { enabled: boolean; mode: 'ai-human' | 'cloned-human'; layout: string; presetId: string; sourcePath: string; voiceSamplePath: string; chromaKeyColor: string } // v1.1, via setAvatar
  rev: number                         // v1.1 — bumped after every host data refresh (panels refetch cached data)
  projectFlags: { hasReferenceVideo: boolean; hasSnapshot: boolean; hasMasterAudio: boolean; hasQaReport: boolean; historyCount: number } // v1.1
  options: {                          // value/label lists for the drawer selects
    engines: Opt[]; creationModes: Opt[]; aspectRatios: Opt[]; qualities: Opt[]
    narrationModes: Opt[]; bgmModes: Opt[]; pacingModes: Opt[]; styles: Opt[]
    // styles / styleCards entries: { value, label, hint, kind: 'auto' | 'preset' | 'user', preset, colors: [3 hex], gradient, swatch, ai }
    //   order: AI 自由匹配 first (label 「AI：<name>」 when the project's last run decided a style), the 6 presets, then 我的风格预设
    // aspectRatios include '3:4' (小红书 · 1080×1440 at 1080p) and '4:3'
    voices: Opt[]                     // first entry is { value: 'auto', label: 'AI 自动匹配' }
    avatarLayouts: Opt[]
    // v1.1 (hint = sub label): platforms, aiBadgePositions, visual3dModes, avatarModes, avatarPresets, emotions,
    // sceneLayouts, threePresets, kenBurns, styleCards ({ value, label, hint, swatch }), figureStyles (人物画风, 8 entries)
  }
  status: {
    llm: { configured: boolean; label: string }       // e.g. "gpt-6.2-sol"
    tts: { ready: boolean; label: string }            // e.g. "IndexTTS-2.5"
    gpu: { label: string; lowSpecMode: string }       // e.g. "RTX 5070 Ti · 12 GB"
    lipsync: { ready: boolean; label: string }        // e.g. "MuseTalk 1.5"
  }
  counts: { plazaTemplates: number; voices: number }
}
type AgentId = 'director' | 'editor' | 'audio' | 'motion' | 'qa' | 'avatar' | 'cloud' | 'reference'
type Opt = { value: string; label: string }
```

### How real pipeline data maps onto the 8 agents (done by the host)

| agent | source |
|---|---|
| director | task `t-director` |
| editor | task `t-editor` |
| audio | task `t-audio` |
| motion | task `t-motion` |
| qa | task `t-render` |
| avatar | task `t-avatar` if the run has it, else `skipped` (or `idle` with no run) |
| cloud | `running` while cloud generations are in flight, `done` when staged results exist this run, else `skipped`/`idle` |
| reference | `done` when the project has an analysed reference video (`referenceStyle`), else `skipped`/`idle` |

### Choreography hints (what the skin should animate on which transition)

| transition | suggested visual |
|---|---|
| `run.status` → `running` | formation launch / loom starts / prism lights up; camera starts following `activeAgentId` |
| `activeAgentId` changes | camera pans/zooms to that agent; hand-off beam/thread/light from previous to new agent |
| editor `running` | every asset with `usedBySceneIds` flies (mechanical-arm / shuttle / light-beam — skin's own metaphor) from the asset bay into the V1 track at the first scene that uses it |
| audio `running` | waveform pulses fill A1 (voice) / A2 (sfx at `sfx[].t`) / A3 (music) tracks |
| motion `running` | scenes' blocks on V1 "come alive" left→right with `progress` |
| qa `running` | scanning sweep across the timeline; preview monitor shows render progress |
| `run.status` → `completed` | celebration beat; preview monitor loads `preview.mp4Url` |
| `failed` / `stopped` | red/grey state on the failing agent with `message`; retry affordance |
| new `logs` entries | append to live log (auto-scroll unless the user scrolled up) |
| `staging` non-empty | show 「云端生成 · 待确认」 cards with 确认入库 / 丢弃 |

## 4. Actions (skin → host)

Every action replies with `dsh-vw/result`. `payload` fields not listed are ignored.

| action | payload | host behaviour |
|---|---|---|
| `run` | `{ topic?: string }` | updates the brief if given, then starts the one-click agent pipeline; fails with `code: 'need-llm'` when the creation mode needs an LLM that is not configured (the kit then opens 设置 · 模型与密钥) |
| `pause` / `resume` / `stop` / `retry` | `{}` | task-center control on the current run |
| `setDirector` | `{ patch: Partial<director> }` | edits the brief/parameters |
| `polishTopic` | `{ topic?: string }` | AI rewrites the topic (async; `director.topic` updates when done); `code: 'need-llm'` without an LLM |
| `importFiles` | `{ files: Array<{ name: string; type: string; data: ArrayBuffer }>, role?: string }` | uploads into the project asset library (send ArrayBuffers as transferables); `role` forces the asset role (`music`, `host_video`, `avatar_base`, `voice_clone` …) |
| `removeAsset` | `{ assetId }` | deletes an asset from the library |
| `confirmStaging` / `discardStaging` | `{ stagingId }` | cloud result → library / discard |
| `selectProject` | `{ dir }` | switch project |
| `createProject` | `{ title?: string, options?: { engine, aspectRatio, quality, style } }` | v1.1 — creates a project (current director params as defaults) and switches to it; `data: { dir }` |
| `deleteProject` | `{ dir }` | v1.1 — deletes a project permanently (confirm in the UI first) |
| `setAvatar` | `{ patch: Partial<avatar> }` | v1.1 — 数字人 settings used by the next run |
| `refresh` | `{ syncForm?: boolean }` | v1.1 — host reloads its data (`syncForm` also re-syncs the brief from the project, e.g. after a reference analysis) |
| `api` / `upload` | see §4b | v1.1 — allow-listed backend proxy used by the native panels |
| `newProject` / `openPanel {panel, args?}` / `openScene {sceneId}` | legacy | answered with an `open-panel` event so the kit opens the native panel (`newProject`, the named panel, or `studio` at the scene) |
| `setSkin` | `{ skin }` | switches skin (host persists it): `nova-deck` / `ink-loom` / `prism-lab` (default) |
| `setLowSpec` | `{ on: boolean }` | toggles low-spec protection |
| `backToChat` | `{}` | (DSH host only) returns to the DSH conversation view |

Preview playback (play/pause/seek of `preview.mp4Url`) is local to the skin's own `<video>` element.

### 4b. Backend proxy for the native panels (v1.1)

* `api` `{ method: 'GET'|'POST', path: '<route relative to /api/video-workbench/>', query?: object, body?: object }` →
  `data: { status, body }` (body = parsed JSON, or `{ ok, text }`). Only allow-listed routes (see `KIT_API_GET` /
  `KIT_API_POST` in `../client.js` and `kit/KIT.md`); anything else fails with `面板接口未开放`. After a mutating POST the host
  applies `autoBound` results and refreshes its data (`state.rev` bumps).
* `upload` `{ path: 'assets/upload'|'bgm/upload'|'reference/upload'|'skin/upload', query?: object, name, type, data: ArrayBuffer }`
  (send `data` as a transferable) → raw `application/octet-stream` POST → `data: { status, body }`.

Host behaviour worth knowing: `run` fails with `ok:false, code:'need-llm'` when the creation mode is `ai-coded` and no
LLM is configured, or with a plain error when a run is already live; `importFiles` names are sanitised (no path separators);
`removeAsset` / `confirmStaging` / `discardStaging` / `selectProject` validate the id and fail with a readable `error`.

## 5. Testing without the backend

`design-prototypes/_shared/harness.html?skin=<id>` loads a skin in an iframe and drives it with realistic state
from `sample-project.json`: onboarding (no project) → idle project → a full simulated run (all 8 agents,
assets flying, logs, beats) → completed with a real preview clip, plus pause/fail/stop/staging buttons,
viewport presets and a log of every action the skin sends. Serve the worktree root with
`python -m http.server 4420 --bind 127.0.0.1` and open
`http://127.0.0.1:4420/design-prototypes/_shared/harness.html?skin=nova-deck`.
