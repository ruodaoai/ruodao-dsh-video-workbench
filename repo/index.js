/**
 * DSH Video Workbench (`dsh-video-workbench`) — Universal Multi-Agent AI Video Studio
 * Supports DeepSeek Harness (Cordis), Claude Code, OpenAI Codex CLI, WorkBuddy, Cursor & Standalone Browser.
 *
 * Copyright (c) 2026 Merziller
 * Author: Merziller | QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com
 * Official Repo: https://github.com/Merziller/dsh-video-workbench (MIT License)
 */
import PresetVideoPlugin, { VIDEO_MAKER_SYSTEM_PROMPT } from './packages/dsh-preset-video/index.js'
import WebVideoWorkbenchPlugin, {
  AUTHOR_INFO,
  handleWorkbenchApiRequest,
  listVideoProjects,
} from './packages/dsh-web-video-workbench/lib/index.js'

export const name = 'dsh-video-workbench'

export function apply(ctx) {
  try {
    ctx.plugin(PresetVideoPlugin)
  } catch {}
  try {
    ctx.plugin(WebVideoWorkbenchPlugin)
  } catch {}
}

export { AUTHOR_INFO, VIDEO_MAKER_SYSTEM_PROMPT, handleWorkbenchApiRequest, listVideoProjects }
export default { name, apply, AUTHOR_INFO }
