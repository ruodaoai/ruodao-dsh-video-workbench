# 🎙️ DSH Video Workbench 音色包规范 (Voice Pack Specification)

本目录用于管理本地 TTS 引擎（`IndexTTS-2` 与 `GPTvoice-tts / GPT-SoVITS`）的音色资产库。支持 **导入自定义音色包**、**AI 根据分镜情绪/角色/受众自动匹配音色** 以及 **用户指定音色**。

---

## 1. 支持导入的音色包格式

你可以通过工作台左栏的 **「🎙️ 音色包管理」** 弹窗，或在对话中调用 `import_voice_pack` 工具导入以下任意格式：

### 格式 A：单文件导入（`.wav` / `.mp3` / `.flac` / `.pt`）
- 直接传入参考音频路径（3~10 秒干净人声 WAV 最佳）或 IndexTTS-2 音色特征文件（`.pt`）。
- 可附带参数：
  - `name`：音色显示名称（如 `"纪录片浑厚男声"`）
  - `gender`：`"male"` | `"female"` | `"neutral"`
  - `tags`：风格标签数组（如 `["纪录片", "浑厚", "历史", "大气"]`）
  - `promptText`：参考音频对应的文本（用于 `GPT-SoVITS` 或 zero-shot 对齐）

### 格式 B：文件夹或 `.zip` 音色包（含 `manifest.json` 或 `voices.json`）
支持标准 `manifest.json` 或兼容现有项目的 `voices.json` 格式：

```json
{
  "packName": "国风纪录片音色包",
  "voices": [
    {
      "id": "doc-male-epic",
      "name": "祁连纪录片男声",
      "engine": "indextts2",
      "gender": "male",
      "tags": ["纪录片", "史诗", "浑厚", "深沉", "文化"],
      "emotions": ["平静", "激昂"],
      "roles": ["narrator", "male"],
      "refAudio": "./male_doc.wav",
      "promptText": "当驼铃声穿透戈壁的风沙，当先民的足迹烙印在祁连山脚下。"
    }
  ]
}
```

### 格式 C：多级分类目录音色包（无需 `manifest.json`，自动解析目录与文件名标签）
完美支持诸如 `不同年龄人群音色/{中年-男声, 孩童, 热门音色, 老年}/*.wav` 的多级分类目录结构：
- **目录名自动映射为分类 (`category`) 与年龄段 (`ageGroup`)**：例如 `中年-男声`、`孩童`、`热门音色`、`老年`。
- **文件名自动拆解风格标签 (`tags`)、性别 (`gender`) 与情绪 (`emotions`)**：
  - 例如：`男-专题 纪录 旁白.wav` → 自动提取分类 `中年-男声`、性别 `male`、标签 `["中年-男声", "男", "专题", "纪录", "旁白", "纪录片"]`、角色 `["narrator", "documentary"]`。
  - 例如：`女-3-5岁、天真可爱.wav` → 自动提取分类 `孩童`、年龄段 `child`、性别 `female`、标签 `["孩童", "女", "3-5岁", "天真可爱", "少儿"]`。
  - 例如：`短视频温柔女青年解说.wav` → 自动提取分类 `热门音色`、年龄段 `youth`、性别 `female`、标签 `["热门音色", "短视频", "温柔", "女青年", "解说"]`。
- **非音频文件自动过滤**：目录内的 `.url`、`免责声明.txt` 等说明文件会被自动忽略。
- **超长参考音频自动切片保护**：对于超过 10 秒的长音频样本（如 14MB~18MB 的有声书试听 WAV），`scripts/tts-bridge.py` 在送入 `IndexTTS-2` 或 `GPT-SoVITS` 前会自动截取最干净的 **8 秒黄金参考片段**，避免显存溢出（OOM）。

---

## 2. AI 自动匹配与手动锁定机制

1. **AI 自动匹配 (`voiceId: "auto"`)**：
   - 当分镜 `voiceId` 为 `"auto"`（或未锁定 `voiceLocked: false`）时，`match_scene_voices` / `generate_speech` 会综合分析：
     - 分镜台词内容（`narration`）与情绪（`emotion`）
     - 分镜角色定位（`role`）与标题（`title`）
     - 项目目标受众（`audience`）与创作目标（`goal`）
   - 自动从音色库计算匹配得分，选择最契合的音色并记录 `voiceMatchReason`。
2. **用户指定音色 (`voiceId: "<id>"`)**：
   - 用户可在 UI 中为全局或单个分镜下拉选择具体音色（自动设置 `voiceLocked: true`），或在对话中直接指令 AI 使用指定音色。
