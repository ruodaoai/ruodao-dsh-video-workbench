import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  buildComplianceNoticeText,
  PLATFORM_SAFE_ZONES,
  readScriptJson,
  resolveBinaries,
  runCommandRedirected,
} from '../shared/index.js'
import { recordPackCover, resolvePackCover, writePackCoverPng } from './cover-studio.js'

function sanitizeSlug(raw) {
  return String(raw || 'dsh-video')
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'dsh-video'
}

/**
 * Generate a complete platform-ready Publishing Package (`publish/<platform>-pack/`):
 * - Final MP4 copy
 * - `cover.png`: the cover chosen in the Studio (发布包导出 → 封面: auto / a picked frame / an AI cover / with title);
 *   default = the best automatic frame of the film (no black, fade, transition or blurry frame — cover-studio.js)
 * - `snapshot-3x3.png` verification contact sheet (if present)
 * - `qa_report.json` (if present)
 * - `meta.md` with platform-ready titles, captions, hashtags, & AI legal compliance declaration
 */
export async function exportPublishPack({
  projectDir,
  platform = '',
  mp4Path = '',
}) {
  const absDir = resolve(projectDir)
  let script = {}
  try {
    script = readScriptJson(absDir).data
  } catch {}

  const targetPlatform = platform || script?.targetPlatform || 'douyin'
  const platformSpec = PLATFORM_SAFE_ZONES[targetPlatform] || PLATFORM_SAFE_ZONES.universal
  const finalMp4 = mp4Path ? resolve(absDir, mp4Path) : join(absDir, 'output', 'final.mp4')
  if (!existsSync(finalMp4)) {
    throw new Error(`找不到成品视频 ${finalMp4}，请先执行一次导出成片再生成发布包。`)
  }

  const packDir = join(absDir, 'publish', `${targetPlatform}-pack`)
  mkdirSync(packDir, { recursive: true })

  const slug = sanitizeSlug(script?.title || 'dsh-video')
  const packMp4 = join(packDir, `${slug}.mp4`)
  copyFileSync(finalMp4, packMp4)

  // Cover: the choice from 发布包导出 → 封面 (cover-studio.js; default = the best automatic frame). A custom mp4Path, or
  // a failure there, falls back to one frame at ~18 % of the film (the old behaviour).
  const coverPng = join(packDir, 'cover.png')
  const durSec = Math.max(1.5, Number(script?.totalDurationSec) || 6)
  let cover = null
  if (resolve(finalMp4) === resolve(join(absDir, 'output', 'final.mp4'))) {
    try {
      const chosen = await resolvePackCover(absDir)
      await writePackCoverPng(chosen.abs, coverPng)
      cover = {
        mode: chosen.mode,
        source: chosen.rel,
        timeSec: Number.isFinite(chosen.timeSec) ? chosen.timeSec : null,
        aspect: chosen.aspect || '',
        refreshed: Boolean(chosen.refreshed),
        fallbackFrom: chosen.fallbackFrom || '',
      }
      try {
        recordPackCover(absDir, targetPlatform, { ...chosen, packFile: coverPng })
      } catch {}
    } catch (err) {
      cover = { mode: 'legacy', error: String(err?.message || err).slice(0, 300) }
    }
  }
  if (!cover || cover.mode === 'legacy') {
    const coverAt = Math.min(durSec * 0.4, Math.max(0.6, durSec * 0.18))
    const { ffmpeg } = resolveBinaries()
    await runCommandRedirected(
      ffmpeg,
      ['-y', '-ss', coverAt.toFixed(2), '-i', finalMp4, '-frames:v', '1', '-q:v', '2', coverPng],
      { timeoutMs: 20_000 },
    ).catch(() => {})
    cover = { ...(cover || {}), mode: 'legacy', timeSec: Number(coverAt.toFixed(2)) }
  }
  const secText = (t) => (Number.isFinite(t) ? `（第 ${t.toFixed(2)} 秒）` : '')
  const coverWhat =
    cover.mode === 'frame'
      ? `选用的视频画面${secText(cover.timeSec)}`
      : cover.mode === 'ai'
        ? `AI 生成封面${cover.aspect ? `（${cover.aspect}）` : ''}`
        : cover.mode === 'title'
          ? '加了标题的封面'
          : cover.mode === 'auto'
            ? `自动挑选的最佳画面${secText(cover.timeSec)}`
            : '高清建议封面图'

  const snapSrc = existsSync(join(absDir, 'output', 'snapshot-3x3.png'))
    ? join(absDir, 'output', 'snapshot-3x3.png')
    : join(absDir, 'snapshot-3x3.png')
  let packSnap = ''
  if (existsSync(snapSrc)) {
    packSnap = join(packDir, 'snapshot-3x3.png')
    copyFileSync(snapSrc, packSnap)
  }

  const qaSrc = join(absDir, 'output', 'qa_report.json')
  let qaData = null
  if (existsSync(qaSrc)) {
    try {
      qaData = JSON.parse(readFileSync(qaSrc, 'utf8'))
      copyFileSync(qaSrc, join(packDir, 'qa_report.json'))
    } catch {}
  }

  const notice = buildComplianceNoticeText(script)
  const titleBase = script?.title || 'AI 视觉创作短片'
  const topicKeywords = (script?.topic || titleBase)
    .split(/[\s,，、/]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 12)
    .slice(0, 4)

  const hashtags = [
    ...new Set([
      ...topicKeywords.map((k) => `#${k}`),
      '#AI视频创作',
      '#DeepSeekHarness',
      targetPlatform === 'xiaohongshu' ? '#效率工具分享' : '#科技视觉大片',
      '#MotionGraphics',
    ]),
  ]

  const summaryLines = (script?.scenes || [])
    .map((s, idx) => `${idx + 1}. **${s.title || `镜头 ${idx + 1}`}** — ${String(s.narration || '').slice(0, 60)}`)
    .join('\n')

  const metaMd = [
    `# ${titleBase} · ${platformSpec.label} 一键发布包`,
    ``,
    `> 生成时间：${new Date().toISOString()}  |  目标平台：**${platformSpec.label}**  |  画面规格：**${script?.width || 1920}×${script?.height || 1080} (${script?.aspectRatio || '16:9'}) @ ${script?.fps || 30}fps**`,
    ``,
    `## 1. 推荐发布标题（3 选 1）`,
    `- **爆款吸睛**：${titleBase}：从想法到成片究竟有多快？`,
    `- **直给干货**：${titleBase} 全流程拆解 (${Math.round(durSec)} 秒高能版)`,
    `- **品质大片**：${titleBase} · 帧级动态视觉实测`,
    ``,
    `## 2. 发布正文与话题标签`,
    `用 AI 驱动分镜、动效代码与真人级语音合成的一体化创作体验。`,
    ``,
    summaryLines ? `**分幕看点：**\n${summaryLines}\n` : '',
    `**话题标签（可直接复制）：**`,
    `${hashtags.join(' ')}`,
    ``,
    `## 3. 内容合规与字体版权说明（平台审核声明）`,
    `- **AI 合成声明**：${notice.endNoticeBody}`,
    `- **角标状态**：已在合成器层强制挂载 \`${notice.badgeText}\` 与片尾声明`,
    `- **商用字体授权**：采用随包分发的 **SIL Open Font License 1.1** 开源字体（Noto Sans SC / Source Han Serif SC），可安全用于商业投放与平台分发`,
    qaData?.loudness?.integratedLufs != null
      ? `- **音频响度与质检**：${qaData.loudness.integratedLufs} LUFS · 峰值 ${qaData.loudness.truePeakDbtp} dBTP · 安全区预检 ${qaData.safeZonePreflight?.passed ? '通过' : '已标记建议'}`
      : '',
    ``,
    `## 4. 包含文件清单`,
    `- \`${slug}.mp4\` (${(statSync(packMp4).size / 1048576).toFixed(2)} MB)`,
    existsSync(coverPng) ? `- \`cover.png\` (${coverWhat})` : '',
    packSnap ? `- \`snapshot-3x3.png\` (3×3 分镜抽帧验收墙)` : '',
    existsSync(qaSrc) ? `- \`qa_report.json\` (成片自动化质检报告)` : '',
    ``,
  ]
    .filter((line) => line !== '')
    .join('\n')

  const metaPath = join(packDir, 'meta.md')
  writeFileSync(metaPath, metaMd + '\n', 'utf8')

  return {
    ok: true,
    platform: targetPlatform,
    platformLabel: platformSpec.label,
    packDir,
    files: {
      mp4Path: packMp4,
      coverPath: existsSync(coverPng) ? coverPng : '',
      snapshotPath: packSnap,
      metaPath,
    },
    suggestedTitles: [
      `${titleBase}：从想法到成片究竟有多快？`,
      `${titleBase} 全流程拆解 (${Math.round(durSec)} 秒高能版)`,
      `${titleBase} · 帧级动态视觉实测`,
    ],
    hashtags,
    cover: existsSync(coverPng) ? cover : null,
    complianceNotice: notice.endNoticeBody,
    metaMarkdown: metaMd,
  }
}
