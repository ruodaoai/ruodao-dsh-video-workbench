import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  ensureWin11ProjectGuards,
  loadHardwarePreferences,
  PACKAGE_ROOT,
  probeHardwareProfile,
  REPO_ROOT,
  resolveLowSpecPolicy,
  saveHardwarePreferences,
  writeScriptJson,
} from '../shared/index.js'
import LocalTtsPlugin from '../dsh-tool-local-tts/index.js'
import AvatarPlugin from '../dsh-tool-avatar/index.js'
import VideoSuitePlugin from '../dsh-tool-video-suite/index.js'
import MediaPlugin, {
  buildRichHtmlVideo,
  writeRemotionProjectFiles,
} from '../dsh-tool-media/index.js'
import { getVibeToolkitStatus } from '../dsh-tool-media/vibe-toolkit-lib.js'

export const VIDEO_MAKER_SYSTEM_PROMPT = `你是 DeepSeek Harness「视频制作模式」(DSH Video Workbench) 的首席电影视觉导演与创意编程工程师，同时精通 **Remotion 4.x (React/TSX)** 与 **HyperFrames HTML5/Canvas** 帧级视频创作。

你的目标不是拼凑廉价 PPT 模板，而是结合用户的**真实素材、本地 205+ 人声配音库 (\`IndexTTS-2.5\`)、配音后 AI 大模型声学修音、48kHz 参数化音效配乐合成器、以及大模型创意编程能力**，创作出电影质感、声画紧咬、零异常黑屏的广播级成片。

## 一、双轨创作工作流（本地草稿练手 -> 大模型 AI 编程精修）

### 轨道 A：零成本本地快速草稿（练手与验证节奏）
1. 导入素材：若用户给出图片/视频/音频文件夹或路径，先调用 \`import_assets\`；可调 \`list_assets\` 核验 \`ffprobe\` 分辨率与时长。
2. 生成本地草稿：调用 \`plan_video_from_assets\` 或 \`produce_video\`（支持自由设置或 \`auto\` AI 智能判断画幅比例 \`16:9\` / \`9:16\` / \`3:4\` / \`1:1\` 与清晰度 \`720p\` / \`1080p\` / \`2k\` / \`4k\`），快速测试文案结构、素材匹配与 \`IndexTTS-2.5\` 本地真人配音。

### 轨道 B：模型无关 AI 编程创作（追求极致电影大片效果）
1. **默认跟随 DSH 客户端模型，也支持四协议自由切换**：
   - 先调用 \`get_llm_config\` 检查模型通道（默认自动跟随 DSH 客户端当前使用的模型与网关密钥；也可在 \`configure_llm_model\` 或右上角设置中切换任意自定义接口，完整支持 **4 种原生协议**：\`openai-completions\` \`/v1/chat/completions\`、\`anthropic-messages\` \`/v1/messages\`、\`openai-responses\` \`/v1/responses\`、\`gemini-native\` \`/v1beta/models\`）。
   - 调用 \`ai_create_video\`（可开启 \`useDraftReference: true\` 读取本地草稿与已锁定音轨作为起跑线）：让大模型编写定制文案、和弦级 \`audioSpec\` 与参数化 \`synth_sfx\` 音效，调用 \`IndexTTS-2.5\` 配音并自动执行 **配音后大模型母带修音 (\`ai_master_voice\`)** 校准 LUFS 响度/EQ/齿音，再编写高质量 Remotion TSX（复用 \`src/lib/shotcraft.tsx\`）或 HyperFrames HTML5 代码并经历 **安全沙箱 + \`video_lint\` + \`tsc --noEmit\` 最多 3 轮自愈修复**，最后渲染导出并执行 \`video_qa\`。
2. **自然语言局部精修与配音后修音**：根据用户反馈调用 \`ai_refine_scene\`（支持 \`rollback: true\` 一键撤回），或单独调用 \`ai_master_voice\` 重新校准人声声学母带。
3. **DSH 对话模型协同直写源码（备选）**：当当前 DSH 会话大模型直接代写或修改工程 \`src/\` 与 \`index.html\` 时，务必严格使用 \`generate_speech\` 生成 \`IndexTTS-2.5\` 配音 -> 调用 \`ai_master_voice\` 修音并锁定 \`script.json\` 帧数、挂载 \`<Audio src={staticFile('master-audio.wav')} />\`、禁止 CSS \`transition:\` / \`@keyframes\` 与 \`Math.random()\`，修改后调用 \`video_lint\` -> \`video_render\` -> \`video_qa\` 验证成片质量。

## 二、Windows 11 本机与工程铁律
1. **零 C 盘占用**：项目、\`.npm-cache\`、音频与成片保持在项目所在盘符。
2. **商用合规字体栈**：\`"Noto Sans SC", "Source Han Serif SC Heavy", sans-serif\` 与 \`"JetBrains Mono", Consolas, monospace\`（禁止使用 \`Microsoft YaHei\` 等闭源商用系统字体）。
3. **零硬编码敏感信息**：禁止在源码写出个人本地盘符路径或明文密钥。

## 三、电脑配置要求与低配电脑保护机制（面向大众开源 · 严禁误拒低配用户）
1. **硬件最低 vs 推荐要求（必须准确告知用户，切勿仅因“无独显/8GB内存”拒用插件）**：
   - **最低可运行配置（开启低配保护模式）**：\`4 核 CPU\` · \`8 GB 内存（可用 ≥ 2.5 GB）\` · \`核显或无独显均可\` · \`3 GB 可用磁盘\`。工作台 Three.js 舞台基于 2D 安全光栅化，无 WebGL 上下文丢失崩溃风险；配音可选 **\`Windows 系统原生语音 (0 显存纯 CPU 开箱即用)\`**、**\`Edge-TTS\`** 或 **\`纯音乐卡点 (免 TTS)\`**。
   - **流畅推荐配置**：\`8 核+ CPU\` · \`16 GB 内存\` · \`NVIDIA 6GB–8GB+ 显存\`（可流畅运行本地 IndexTTS-2.5 / GPT-SoVITS 与 1080p60 渲染）。
   - **4K 旗舰配置**：\`12 核+ CPU\` · \`32 GB+ 内存\` · \`NVIDIA RTX 8GB–16GB+ 显存\`。
2. **低配电脑保护机制**：当检测到内存/CPU/显存偏低或用户开启「低配保护模式 (\`lowSpecMode: "safe"\`)」时，工作台会自动将 Remotion 渲染降为 **单并发 + 128MB 轻缓存 + 延长渲染超时 + FFmpeg 限线程 \`veryfast\` 编码 + Three.js 粒子减载 + 必要时自动护航为 720p/1080p 30fps**。
   - 若用户询问“我电脑配置够不够/为何提示配置低”，请先调用 \`check_hardware_profile\` 实测其 CPU、内存、显存与磁盘空间，并给出精准档位与「纯CPU配音/低配保护」方案。

## 四、可用核心工具清单
- 算力体检与低配保护：\`check_hardware_profile\`（实时检测 CPU / 内存 / GPU 显存 / 磁盘与低配保护开关 \`auto\` / \`safe\` / \`performance\`）
- 素材与智能剪辑：\`import_assets\`、\`list_assets\`、\`curate_and_edit_assets\`（ffmpeg 裁切构图、调色增强、抠图匹配）、\`generate_sfx_bgm\`、\`plan_video_from_assets\`、\`produce_video\`、\`import_vendor_motion\`
- 多 Agent 协同与数字人：\`run_agent_pipeline\`（⚡ 一键全自动出片 4-Agent 流水线：策划导演 -> 素材剪辑 -> 配音混音 -> 动效质检）、\`generate_avatar\`（透明通道 yuva420p 克隆真人 / 纯 AI 数字人口播叠层）
- 模型与 AI 编程：\`get_llm_config\`、\`configure_llm_model\`、\`ai_master_voice\`、\`ai_create_video\`、\`ai_refine_scene\`、\`video_qa\`
- 语音与音色包：\`list_voices\`、\`import_voice_pack\`、\`match_scene_voices\`、\`generate_speech\`
- 检测与交付：\`video_lint\`、\`video_snapshot\`、\`video_render\`、\`export_publish_pack\`
`

/**
 * Generate a rich HTML5/Canvas dual-engine `index.html` with `<template>` scene isolation,
 * user image/video rendering, Ken Burns motion, bokeh particles, and async `window.__seekToFrame`.
 */
export function buildHtmlSceneTemplate(script) {
  return buildRichHtmlVideo(script)
}

/**
 * Initialize a new Dual-Engine Video Project with `.npmrc`, `script.json`, and entry files.
 */
export function scaffoldVideoProject(projectDir, options = {}) {
  const absDir = resolve(projectDir)
  ensureWin11ProjectGuards(absDir)

  const title = options.title || 'DeepSeek Harness 双引擎视频演示'
  const engine = options.engine === 'html' ? 'html' : 'remotion'
  const fps = Number(options.fps) || 30
  const style = options.style || 'tech'

  const initialScript = {
    title,
    engine,
    style,
    fps,
    width: 1920,
    height: 1080,
    visual3dMode: options.visual3dMode || 'auto',
    audience: options.audience || '开发者与数字内容创作者',
    goal: options.goal || '展示素材导入、AI 分镜策划、音效配乐混音、双引擎动效与本地真人配音全链路能力',
    aiBadge: options.aiBadge !== undefined ? Boolean(options.aiBadge) : true,
    targetPlatform: options.targetPlatform || 'universal',
    bgmMode: options.bgmMode || 'llm-coded',
    creationMode: options.creationMode || 'ai-coded',
    voiceMode: options.voiceMode || 'auto',
    defaultVoiceId: options.defaultVoiceId || 'auto',
    bgm: options.bgm || {
      enabled: true,
      mood: style === 'cinematic' ? 'cinematic' : style === 'warm' ? 'warm' : 'tech',
      volume: 0.2,
    },
    theme: options.theme || {
      background: '#070B16',
      surface: '#111A30',
      textPrimary: '#F8FAFC',
      textSecondary: '#CBD5E1',
      accent: '#38BDF8',
    },
    scenes: options.scenes || [
      {
        id: 'scene-01',
        title: '双引擎动效：从素材到成片',
        narration:
          '欢迎体验 DeepSeek Harness 视频工作台。导入你的图片、视频与音乐素材，AI 自动完成文案编排、Three.js 3D 动效、节拍弹簧与真人配音。',
        emotion: '平静',
        role: 'host',
        voiceId: 'auto',
        layout: '3d-stage-opener',
        threePreset: 'orbital-core',
        camera: 'zoom-in',
        transition: 'iris-circle',
        vfx: '3d-depth+sweep',
        sfxCue: 'hit',
        highlights: ['Three.js 3D 舞台', '节拍弹簧物理', '一键成片'],
        visualPrompt: '3D 透视浮动卡片环绕聚拢，配合逐字弹性冲击标题与光束扫过。',
        durationSec: 4.5,
      },
      {
        id: 'scene-02',
        title: '动态 SVG 架构与多轨混音',
        narration:
          '内置动态 SVG 架构拓扑总线与两百零五个本地音色，配合节拍同步弹簧物理与背景音乐闪避技术，让系统架构与声音细节清晰突出。',
        emotion: '高兴',
        role: 'storyteller',
        voiceId: 'auto',
        layout: 'svg-architecture-flow',
        threePreset: 'cyber-terrain',
        camera: 'pan-left',
        transition: 'block-wipe',
        vfx: 'sparks+shockwave',
        sfxCue: 'whoosh',
        highlights: ['动态 SVG 拓扑', '光子数据总线', '48kHz 自动闪避'],
        visualPrompt: '动态 SVG 节点拓扑与贝塞尔光子脉冲随节拍弹簧跃动。',
        durationSec: 5.0,
      },
      {
        id: 'scene-03',
        title: 'HUD 遥测面板：全帧率高清交付',
        narration:
          '搭载全息 HUD 遥测数据仪表与 TSX 实时代码流，双引擎确定性逐帧捕获，一键输出广播级高清成片视频。',
        emotion: '激昂',
        role: 'narrator',
        voiceId: 'auto',
        layout: 'hud-telemetry-dashboard',
        threePreset: 'particle-vortex',
        camera: 'zoom-out',
        transition: 'zoom-punch',
        vfx: 'radial-speedlines',
        sfxCue: 'chime',
        highlights: ['HUD 遥测仪表', '实时代码流', '60FPS 确定性渲染'],
        visualPrompt: '全息 HUD 环形仪表盘与 TSX 代码流同步滚动，定格品牌印章。',
        durationSec: 4.5,
      },
    ],
  }

  const saved = writeScriptJson(absDir, initialScript)
  const htmlPath = join(absDir, 'index.html')
  writeFileSync(htmlPath, buildHtmlSceneTemplate(saved.data), 'utf8')

  if (engine === 'remotion') {
    writeRemotionProjectFiles(absDir, saved.data)
  }

  return {
    projectDir: absDir,
    scriptPath: saved.scriptPath,
    htmlPath,
    script: saved.data,
  }
}

export const name = 'dsh-preset-video'

export function apply(ctx) {
  // 0. Register `check_hardware_profile` tool so DSH Assistant can verify PC specs & low-spec protection accurately
  if (ctx?.tools && typeof ctx.tools.register === 'function') {
    try {
      ctx.tools.register({
        name: 'check_hardware_profile',
        description:
          'Probe host PC hardware (CPU cores, total/free RAM, GPU VRAM, disk space), return minimum vs recommended requirements, recommend optimal TTS engine for low-spec PCs, and inspect or update Low-Spec Protection mode (auto | safe | performance).',
        parameters: {
          type: 'object',
          properties: {
            lowSpecMode: {
              type: 'string',
              enum: ['auto', 'safe', 'performance'],
              description: 'Optional mode update: auto (adaptive protection), safe (forced low-spec protection), performance (full multi-tab speed).',
            },
            requestedQuality: {
              type: 'string',
              description: 'Optional target quality to evaluate protection policy against (720p, 1080p, 2k, 4k).',
            },
            requestedFps: {
              type: 'number',
              description: 'Optional target fps (30 or 60).',
            },
          },
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
        },
        timeoutMs: 15_000,
        isReadOnly: () => true,
        isConcurrencySafe: () => true,
        async execute(args = {}) {
          if (args.lowSpecMode) {
            saveHardwarePreferences(REPO_ROOT, { lowSpecMode: args.lowSpecMode })
          }
          const hardware = probeHardwareProfile({ targetDir: REPO_ROOT, forceRefresh: true })
          const pref = loadHardwarePreferences(REPO_ROOT)
          const policy = resolveLowSpecPolicy({
            repoRoot: REPO_ROOT,
            hardware,
            modePref: pref.lowSpecMode,
            requestedQuality: args.requestedQuality || '1080p',
            requestedFps: Number(args.requestedFps) || 30,
          })
          let vibeToolkit = []
          try {
            vibeToolkit = getVibeToolkitStatus()
          } catch {}
          return { ok: true, hardware, preferences: pref, policy, vibeToolkit }
        },
      })
    } catch {}
  }

  // 1. Register local TTS, Video Suite, and Media Production tools directly in current context
  for (const subPlugin of [LocalTtsPlugin, AvatarPlugin, VideoSuitePlugin, MediaPlugin]) {
    try {
      ctx.plugin(subPlugin)
    } catch {}
  }

  // 2. Register the `视频制作模式` (id: `video-maker`) preset safely if `agentPresets` service is available
  try {
    ctx.inject(['agentPresets'], (innerCtx) => {
      try {
        const reg = innerCtx?.agentPresets
        if (!reg || typeof reg.register !== 'function') return
        if (reg.definitions instanceof Map && reg.definitions.has('video-maker')) return
        if (typeof reg.get === 'function') {
          try {
            if (reg.get('video-maker')) return
          } catch {}
        }
        const res = reg.register({
          id: 'video-maker',
          name: '视频制作模式',
          description:
            '支持素材导入、AI 分镜策划、音效配乐混音、Remotion + Three.js 3D / HTML5 双引擎动效与本地真人配音全链路视频工作台。',
          order: 15,
          plugins: [
            {
              id: 'persona',
              name: '@deepseek-ai/dsh-persona',
              config: {
                prefix: VIDEO_MAKER_SYSTEM_PROMPT,
              },
            },
            { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions' },
            { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
            { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
            { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
            { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
            { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search' },
            { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
            { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem' },
            { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
          ],
        })
        if (res && typeof res.catch === 'function') {
          res.catch(() => {})
        }
        if (typeof res === 'function' && typeof innerCtx.effect === 'function') {
          innerCtx.effect(() => () => {
            try {
              res()
            } catch {}
          })
        }
      } catch {}
    })
  } catch {}
}

export default { name, apply }
