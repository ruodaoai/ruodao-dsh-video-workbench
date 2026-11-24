# AI 视频全链路工作台（若道桌面端集成包）

> 英文文档：[README.en.md](./README.en.md)

把 [DSH Video Workbench](https://github.com/Merziller/dsh-video-workbench)（作者 Merziller，MIT）接进若道桌面端：一句话需求到成片，全程在一个工作台里完成。

> 本仓库是若道桌面端的**集成包**，上游原创项目与完整文档见 [Merziller/dsh-video-workbench](https://github.com/Merziller/dsh-video-workbench)。二次分发请完整保留原作者署名。

## 能力

- **双引擎渲染**：Remotion（TSX 逐帧确定性）+ Three.js / HTML5 CDP 两套引擎，按镜头需要选择。
- **AI 作战大屏**：三套皮肤，实时展示 Agent 计划、镜头进度、编码与渲染状态。
- **内置人物库与人物画风**：剪影 / 剪纸 / 皮影 / 水墨 / 扁平 / 火柴人 6 种画风、37 种动作；也可让 AI 自定义角色画风。
- **画面自检**：每镜渲染截图后由能看图的模型逐镜检查人物、构图、文字与亮度，问题镜头带截图返工。
- **Vibecoding 8 工具**：AI 按镜挑选工具，工具满足不了的效果直接写代码实现。
- **影核广场**：MOTION.md 模板浏览、套用、投稿；支持在线模板刷新。
- **参考视频拆解复刻**：FFprobe + 切点检测 + BPM/落点分析 + 9 帧接触表，输出可复刻的 MOTION.md。
- **节拍卡点与音频**：BPM 节拍卡点、48kHz 音效母带、多引擎配音（Windows 原生 / Edge-TTS / 本地克隆）。
- **BYOK 云端生成**：Seedream / Seedance / Kling / Flux / Suno / MiniMax 与自定义 HTTP 协议，可关联若道模型与本地生图号池。
- **MCP 工具**：41 个工具供 Agent 直接调用（分镜、配音、渲染、质检、导出发布包等）。

## 安装

1. 在若道桌面端「功能插件市场」安装本插件（或在开发环境把本目录放入 `plugins/`）。
2. 首次打开按引导选择工作目录与模型；画幅、时长、风格在「02 导演参数」里设置。
3. 需要云端生成时在「设置 → 云端生成」填自己的 Key；免费素材（Pexels / Pixabay）Key 同样在页面里填。

## 权限与隐私

- 权限：`storage` / `process` / `network` / `clipboard`。
- 视频工程、素材与渲染产物只写本机工作目录；云端生成只在你配置了 Key 且主动勾选时发生。
- 不采集、不上传本机路径、密钥或个人信息。

## 许可

MIT。上游版权归 Merziller；若道集成层版权归 Ruodao。