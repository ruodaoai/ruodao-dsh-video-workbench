# 原生面板内核 · Panel Kit (`PK`)

The user's requirement (verbatim intent): every panel, popup, card and button that the war room opens must be **native to the
war-room skin** — designed in that skin's visual language like the three approved prototypes
(`design-prototypes/{nova-deck,ink-loom,prism-lab}/index.html`) — never the old "classic" React UI. The classic UI has been
**deleted** from the host (`lib/client.js`). 棱镜实验室 (`prism-lab`) is the default skin; 星舰剪辑甲板 (`nova-deck`) and
墨韵织机 (`ink-loom`) are switchable. Functionality and interaction logic must stay correct and complete.

Architecture:

* **One panel kernel, three looks.** All panel logic is written once in `lib/warroom/kit/src/*.js` and composed from semantic
  primitives (`PK.ui.*`, DOM with `pk-*` classes). Each skin restyles the primitives and the frames (modal / drawer /
  workspace) in its own CSS so the panels look like the prototype's panels.
* **The kit talks to the backend only through the host bridge** (`lib/warroom/BRIDGE.md`): generic allow-listed `api` /
  `upload` actions plus a few state-keeping host actions (`setDirector`, `setAvatar`, `importFiles`, `run`, `createProject`…).
* Build: `node packages/dsh-web-video-workbench/lib/warroom/kit/build.mjs` → `lib/warroom/kit.js` + `lib/warroom/kit.css`
  (generated; every module is syntax-checked separately and wrapped in try/catch — a broken module is left out and the
  build exits 1, so it never breaks the other panels). Skins load them relatively:
  `<link rel="stylesheet" href="kit.css">` (before the skin's `<style>`) and `<script src="kit.js"></script>` (before the
  skin's script), then `PK.configure({ skin: '<id>', … })`.

## Files

| file | owner | content |
|---|---|---|
| `src/00-core.js` | coordinator | namespace, utils (`PK.util`), events, bridge (`PK.action/api/get/post/postP/upload/importFiles/job`), `PK.store`, `PK.waitState` |
| `src/10-ui.js` | coordinator | DOM builder `PK.h`, icons `PK.icon`, primitives `PK.ui.*`, shared audio `PK.audio` |
| `src/20-frame.js` | coordinator | frames (`PK.frame`), toasts, `PK.confirm/prompt/editText`, popovers `PK.menu/pickFrom/popover` |
| `src/25-cinema.js` | coordinator | `PK.cinema({ src, poster, title, sub, startAt, onClose })` — the shared full-window film viewer (全屏观看) |
| `src/30-router.js` | coordinator | `PK.panel/open/close/catalog`, legacy aliases, host events, `PK.editTopic` (big 主题需求 editor) |
| `src/40-studio.js` | coordinator | the 分步精修 workspace shell + `PK.studioStep(id, def)` |
| `src/50-panels-base.js` | coordinator | `projects`, `newProject`, `help`, `kitchen` (hidden showcase of every primitive) |
| `src/60-studio-assets.js` | panel agent A | studio steps `assets` (素材) + `director` (导演参数 incl. 数字人开关/音色/BGM…) |
| `src/61-studio-scenes.js` | panel agent B | studio steps `scenes` (分镜精修) + `delivery` (交付) |
| `src/70-settings.js` | panel agent C | `keys` (设置 · 模型与密钥), `voices` (配音中心), `cloud` (云端媒体), `avatar` (数字人), `hardware` (算力体检) |
| `src/80-ops.js` | panel agent D | `tasks` (任务中心), `plaza` (影核广场), `reference` (参考复刻), `teleprompter` (提词器录制) |
| `src/81-project-tools.js` | panel agent E | `export` (发布包导出), `brand` (品牌套件), `history` (版本历史与工程安全) |
| `src/kit.css` | coordinator | structural base styles + `--pk-*` variables |
| skin CSS / chrome | skin agents | inside each skin document (and its build sources) |

Never edit another owner's file. If you need a core change (a primitive, a host action, an allow-listed route), write it
in your progress notes / final report — or, for small additive helpers, put them in your own module.

## Host bridge (what the kit can do)

`PK.state` is the latest `WarRoomState` (BRIDGE.md §3) — project, director (all brief/param fields, see below), runOptions,
avatar, options (all value/label lists), status chips, run/agents/logs, timeline, preview, `rev` (bumped after every host
data refresh), `projectFlags`. Subscribe with `PK.on('state', (st, prev) => …)` or use a panel's `watch`.

| call | what |
|---|---|
| `await PK.store.load(force?)` | raw `GET /state?projectDir=` snapshot: `projects, activeProject{projectDir, script, assets, notes, assetSummary, hasMp4, hasReferenceVideo, referenceVideoRel, hasSnapshot, hasMasterAudio, hasAvatarClip, sceneThumbs, qaReport, buildLog, historyCount}, llmConfig, ttsConfig, ttsInstallCatalog, cloudMedia, stagedCloudAssets, plazaBrand, plazaCategories, plazaTemplates, voiceCatalog, voiceCategories, availableEmotions, ttsStatus, brandKit, authorInfo, hardwareProfile, hardwarePreferences, hardwarePolicy, vibeToolkit, avatarTemplates, avatarProvider, taskRuns`. Cached per `PK.state.rev`. |
| `await PK.get(path, query)` / `PK.post(path, body)` / `PK.postP(path, body)` | allow-listed plugin routes (relative to `/api/video-workbench/`). `postP` adds `projectDir`. Returns the JSON body, throws `PK.Error` on HTTP ≥ 400 or `{ok:false}`. After every mutating POST the host refreshes its data (and `rev` bumps) automatically. |
| `await PK.upload(path, file, { query })` | raw binary upload: `bgm/upload`, `reference/upload`, `skin/upload`, `assets/upload` (metadata in the query, e.g. `{ projectDir, fileName }`) |
| `await PK.importFiles(files, { role })` | import into the asset library through the host (keeps its auto-binding of BGM / 数字人底板 / 声音克隆样本 / 真人出镜) |
| `await PK.job(jobId, { onProgress })` | poll `GET jobs?id=` until done (`job.status: done/error`), returns `job.result` |
| `await PK.action(name, payload)` | host actions: `run {topic?}`, `pause/resume/stop/retry`, `setDirector {patch}`, `setAvatar {patch}`, `polishTopic {topic?}`, `importFiles`, `removeAsset {assetId}`, `confirmStaging/discardStaging {stagingId}`, `selectProject {dir}`, `createProject {title, options:{engine,aspectRatio,quality,style}}`, `deleteProject {dir}`, `refresh {syncForm?}`, `setLowSpec {on}`, `setSkin {skin}`, `backToChat` |
| `PK.assetUrl(rel)` | same-origin URL of a project file (for `<img>/<video>/<audio>`) |
| `PK.routeUrl(path, query)` | same-origin URL of a GET route (e.g. `voices/preview`, `plaza/preview`, `reference/video`) for media elements |

`setDirector` patch keys: `topic, engine, creationMode('ai-coded'|'fast-draft'), aspectRatio(+'custom'), quality(+'custom'), fps,
durationMode, targetDurationSec, narrationMode, bgmMode, pacingMode, style, voiceId, avatarEnabled, avatarLayout, displayTitle,
genre, genreLabel, directorNotes, contentOutline(string[]), bgmTtsPrompt, targetPlatform, customWidth, customHeight,
aiBadgeEnabled, aiBadgePosition, aiBadgeText, visual3dMode, visualReview, figureStyleChoice, figureStyleChoiceNote,
useDraftReference, speechTempo, useHostVocal, aiAuthorCode, trimClipSec, clipSpeedMult` (validated by the host; invalid
values are ignored). `setAvatar` keys: `enabled, mode, layout,
presetId, sourcePath, voiceSamplePath, chromaKeyColor`.

Allow-listed GET: `state hardware jobs llm-config tts-config code safe-zone tasks avatar/config avatar/lipsync tts/install-options
brand-kit cloud-media cloud-media/staging plaza/templates plaza/template color-lut project/history project/scene-edits
project/characters project/cloud-jobs`. Allow-listed POST: `hardware llm-config llm-test tts-config tts-test script assets/import
assets/delete assets/role assets/curate assets/starter-pack assets/recording plan produce ai-produce ai-refine qa voices/import
voices/clone-upload voices/delete voices/clone-preview voices/match audio/llm-compose audio/tts-compose publish-pack vendor/import
action tasks/control teleprompter/generate avatar/generate avatar/config avatar/lipsync/install polish-topic tts/install
tts/repair-voices reference/analyze reference/clear brand-kit motion-md cloud-media cloud-media/generate cloud-media/assist-prompt
cloud-media/staging/commit cloud-media/staging/discard plaza/apply plaza/publish export scopes color-lut qa-deep
project/history/diff project/history/restore project/history/snapshot project/history/prune project/scene-lock
project/scene-overrides project/scene-overrides/batch project/characters/save project/characters/delete project/characters/attach
project/stock/search project/stock/import project/refine`. (`pipeline/start` → use the `run` action; projects → actions.)

Errors: `PK.Error` (`message`, `code`). `code:'need-llm'` → the kit shows its own message and opens 设置 · 模型与密钥
automatically, so skins must NOT toast that error again. Host error toasts arrive as `event:error` and are shown by the
kit with their fix-it action.

Re-rendering: `ctx.update()` (coalesced) waits while a mouse button is held inside the kit or an IME composition is in
progress, and runs on release — so host data refreshes never eat a click or commit half-typed pinyin. `ctx.render()`
is immediate. Popovers are always kept inside the viewport.

## Reference implementation of the old behaviour

The deleted classic UI is kept for reference (read-only) at `.tmp/kit-ref/client.classic.js` (12 637 lines). Port the
**behaviour** (API calls, payloads, validation, side effects, user-facing wording) — never its look. Sections:
`step1Panel` 8085 (素材 + 提词器拍摄棚 ~8150), `step2Panel` 8464 (导演参数, 数字人 ~8990), `step3Panel` 9137 (分镜精修),
`step4Panel` 9746 (交付), `taskCenterView` 9993, `llmHubContent` 10142, `ttsHubContent` 10267, `voiceModal` 10627,
`vendorModal` 10792, `hardwareModal` 10823, `newProjectModal` 10981, `codeDrawer` 11001, `plazaModal` 11050,
`plazaPlayerModal` 11235, `cloudHubContent` 11405, `aiEngineHubModal` 11787, pro tools (history/locks/characters/stock/
cloudjobs/lipsync) 11871-12065, `previewLightboxModal` 12113, `compareModal` (参考复刻对比) 12153, `projectDrawer` 6680.
Handlers: `grep -n "const handle" .tmp/kit-ref/client.classic.js` (e.g. handleSaveScriptEdits 3844, handleAiRefine 3928,
handleSynthesizeSceneTts 3897, handleRenderMp4 4033, handleRunQaOnly 4062, handleExportPublishPack 4081, collectSceneOverrides
/ recordSceneOverridesAfterSave (scene override protection — MUST be kept when saving scene edits), handleSaveLlmConfig 4816,
handleTestLlm 4790, handleSaveBuiltinTts 4860, handleSaveCustomTts 4940, handleTestTtsEngine 5044, handleInstallTtsPackage 3496,
handleSubmitVoiceClone 4649, handleImportVoicePack 4530, handleGenerateCloudMedia 3158, handleAssistCloudPrompt 3119,
handleGenerateAvatarClip 4465, handleStartWebcam 4254 / recording 4358-4431, handleGenerateTeleprompter 4437,
handleUploadReferenceVideo 2893, handleApplyPlazaTemplate 2991, handlePublishToPlaza 3020, loadProTab 5192 …).
Backend routes: `packages/dsh-web-video-workbench/lib/index.js`, `routes-project.js`, `routes-delivery.js`.

## Writing a panel

```js
;(function () {
  'use strict'
  const PK = window.PK, U = PK.util, h = PK.h, ui = PK.ui
  PK.panel('voices', {
    title: '配音中心', en: 'VOICE LIBRARY · 音色库', idx: 'VO', icon: 'voice',
    kind: 'modal', size: 'lg', group: 'tools', order: 30, desc: '试听、指定主讲、克隆音色',
    needsProject: false,
    aliases: { voice: {} },                       // legacy names that open this panel
    watch: (st) => st && st.rev,                  // re-render trigger (keep narrow; never re-render on every tick)
    onWatch: (ctx) => ctx.load(true),             // e.g. reload data when the host refreshed
    mount(ctx) { ctx.local.q = ''; ctx.load() },  // ctx.load() → ctx.data = raw /state (re-renders when done)
    render(ctx) {
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading()
      ctx.foot([ui.hint('…'), ui.spacer(), ui.btn('导入音色包', importPack, { icon: 'upload' })])
      return [ui.section({ title: '音色库', en: 'LIBRARY', count: n }, …)]
    },
  })
})()
```

* `ctx`: `args`, `local` (your state — survives re-renders), `data/loadError/load(force)`, `render()` (immediate, keeps focus,
  caret and scroll), `update()` (coalesced), `foot(nodes)`, `setTitle(t, en)`, `busy(text|false)`, `task(label, fn, {ok,
  fail})` (busy strip + error toast), `close()`, `listen(ev, fn)`, `every(ms, fn)`, `onCleanup(fn)`.
* Give stable `key`s to inputs (`ui.input({ key: 'llm-key', … })`) so focus/caret survive re-renders.
* **Never overwrite what the user is typing**: keep form drafts in `ctx.local`, save explicitly (button) or on change;
  re-render from the drafts.
* Async buttons: `ui.btn(label, async () => …, { busyText })` shows a busy state and toasts thrown errors.
* Long content must be fully readable: multi-line text → `ui.textarea` (auto-grows, ⤢ opens the big editor);
  names → single line with ellipsis + `title`. Never clip, never overlap. Use `ui.grid`/`ui.split` (responsive) instead of
  fixed widths. Panels must work from **1100×640** (DSH side panel) to 2560×1440.
* Chinese UI copy, beginner-friendly (the user has zero background): say what a control does; errors say how to fix.
* Use `PK.confirm` before destructive actions (delete / restore / overwrite / install).
* No `fetch`, no `eval`, no external URLs, no network except through the bridge.

### UI primitives (`PK.ui`)

layout: `section({title,en,icon,count,actions,desc,key}, …children)`, `row(children,{wrap,between,end,center,top,gap})`,
`stack(children)`, `grid(children,{min,fit})` (`fit:true` → items stretch over the row instead of leaving empty column
slots: use it for form fields, not for card walls), `split(left,right,{ratio})`, `spacer()`, `divider(label)` ·
text: `text(s,{tone:'muted'|'dim',mono})`, `hint(s)`, `mono(s)`, `strong(s)`, `note(text,{level:'info'|'ok'|'warn'|'error',title,actions})`,
`kv(pairs)`, `pill(text,tone:'ok'|'warn'|'err'|'acc'|'mute',{dot})`, `tag(text,{active})`, `stat(value,label)`,
`empty({icon,title,text,actions})`, `spinner(label)`, `loading(label)`, `errorBox(err,retry)` ·
buttons: `btn(label,onClick,{kind:'primary'|'secondary'|'ghost'|'danger'|'link',size:'sm'|'md'|'lg',icon,busyText,confirm,disabled,block,title})`,
`iconBtn(icon,onClick,{title})`, `link(label,href)` ·
form: `field({label,en,hint,error,required,inline,aside}, control)`, `input({value,onInput,onChange,onEnter,type,placeholder,key,mono,maxLength,min,max,step})`,
`textarea({value,onInput,onChange,rows,minRows,maxRows,maxLength,counter,key,mono,expand:{title,templates,actions}|false})`
(the ⤢ button sits in the box's reserved right gutter; the counter is rendered BELOW the box so it never covers text;
`expand:false` also drops the gutter),
`select({value,options,onChange,searchable,placeholder,showHint})`, `seg({value,options,onChange})`, `toggle({value,onChange,label,hint})`,
`check({value,onChange,label})`, `slider({value,min,max,step,onChange,onInput,format})`, `chips({value,options,onChange,multi})`,
`color({value,onChange})`, `file(label,onFiles,{accept,multiple})`, `drop({label,hint,accept,multiple,onFiles,filter})`, `PK.pickFiles({accept,multiple})` ·
lists: `list(items,{dense})`, `item({lead,icon,thumb,title,sub,meta,right,body,onClick,active,tone,key,tip})`,
`card({media,aspect,badge,title,sub,body,tags,actions,onClick,active})`, `table({columns:[{key,label,width,align,render}],rows,empty,onRow,isActive})` ·
progress: `meter(pct,{label,valueText,tone,indeterminate})`, `steps([{label,sub,state,n,value}],{onClick})`, `tabs({value,items:[{value,label,icon,badge}],onChange})`,
`log(lines)`, `code(text)` · media: `video(src,{poster,controls,autoplay,loop,muted,aspect,empty})`, `image(src,{aspect,fit})`,
`audio(src)`, `playBtn(srcOrAsyncFn,{label,stopLabel,key})` (`key` identifies the clip across re-renders — defaults to the
URL when src is a string; pass one when src is a function, so a re-rendered button still shows 「停止」) · overlays: `PK.toast(text, level, {title,detail,action,timeout})`,
`PK.confirm({title,text,ok,danger})`, `PK.prompt({title,label,value,multiline})`, `PK.editText({title,value,maxLength,templates,actions,extraButtons})`,
`PK.editTopic()` (the shared 主题需求 editor), `PK.menu(anchor, items)`, `PK.popover(anchor, node)`,
`PK.cinema({src,poster,title,sub,startAt,onClose})` (the finished film over the whole window: native controls, 「全屏」 / `F`
= real browser fullscreen, `Space` / `←` `→` / `M`, `Esc` closes; `onClose({time,playing,duration})` returns the moment).
See them all live: `PK.open('kitchen')`.

### Studio steps

```js
PK.studioStep('scenes', { label: '分镜精修', en: 'SCENES', icon: 'film', order: 30, render(ctx, s) { … } })
```
`s = { data, project, script, local, go(stepId, args), reload(), args }` — `ctx` is the studio panel ctx (use `ctx.foot`,
`ctx.task`, `ctx.render`). `ctx.args.sceneId` is set when the main screen opened a scene. Return a node or an array. For a
fixed-height multi-pane layout wrap your content in `h('div.pk-fill', …)` (the step body then stops scrolling and you manage
inner scroll areas; give them `data-pk-scroll="<unique>"` so their scroll position survives re-renders).

## Test bench

* Studio with the real host, backend, skins and kit: `npm run studio` (port 4399, or `DSH_VIDEO_PORT=<port>`). For
  experiments, point `DSH_VIDEO_HOME` / `DSH_VIDEO_WORKSPACE` at a scratch folder so your real projects stay untouched.
  AI calls go to your configured provider and cost money — keep them to the minimum needed to prove a flow works.
* Acceptance test (real router + standalone host + all three skins + kit, headless Chrome):
  `node scripts/tests/warroom-ui.e2e.mjs --gpu [--skins prism-lab,nova-deck,ink-loom] [--viewports 1100x640,1920x1080]
  [--full] [--shots <dir>]`. It checks every panel and studio step at every viewport (no clipped or overlapping text, no
  console errors, toasts never covering a panel's footer buttons), the brief round trip, and with `--full` a real
  local-draft one-click render. Prefer `--gpu`; the software renderer is portable but slow enough to time out on the
  animated skins.
* Overlap checker for manual inspection: copy the `OVERLAP` (panels) or `MAIN_OVERLAP` (main screen) expression from
  `scripts/tests/warroom-ui.e2e.mjs` and evaluate it in the skin window; it returns a list of clipped / covered texts.
* Rebuild after every edit: `node packages/dsh-web-video-workbench/lib/warroom/kit/build.mjs` (the studio serves the new
  kit.js immediately; reload the page).
* Windows + Git Bash: write scripts to files and run them with node; heredocs mangle backslashes and backticks.

## Skin integration contract

* Load order: `kit.css` before the skin `<style>`; `kit.js` before the skin script; then
  `PK.configure({ skin, frames: { panelId: 'modal'|'drawer'|'workspace' }, sizes: {…}, icon(name,size) {…}, toast(text, level, opts) {…} })`.
* Theme every `pk-*` primitive and frame in the skin's own visual language (variables `--pk-*` in kit.css, plus skin-specific
  selectors under `[data-pk-skin="<id>"]` / `#pk-root`), based on the prototype's own drawers/modals/cards/buttons.
* Every entry point opens a native panel: `PK.open('<id>', args)`. Menus can be built from `PK.catalog()`.
* Brief / topic inputs open `PK.editTopic()` on click/focus (the big editor with templates, AI 润色, 保存并一键出片).
* While `PK.isOpenAny()` is true the skin's global keyboard shortcuts must not fire.
* A finished film can always be watched full-window: the skin's preview monitor offers 「全屏观看」 (button + key `V`) that
  calls `PK.cinema({ src: state.preview.mp4Url, startAt })` and continues its monitor at `onClose().time`.
* The skin's own toasts and the kit toasts must not stack on top of each other (either route `PK.configure({ toast })` to
  the skin's toast or let the kit render them).

Panel ids: `studio`(+steps assets/director/scenes/delivery) `tasks` `plaza` `keys`(args `{tab:'llm'|'tts'|'cloud'|'general'}`)
`voices` `cloud` `avatar`(args `{tab:'lipsync'|'provider'|'generate'}` scroll to that section; alias `lipsync`) `hardware`
`teleprompter` `reference` `brand` `export` `history` `projects` `newProject` `help`
(`kitchen` hidden). Legacy names (`llm`,`tts`,`prompter`,`compute`,`pack`,`voice`,`refine`,`ref`,`compare`,`hub`…) resolve via aliases.
