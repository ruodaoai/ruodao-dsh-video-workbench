/**
 * `dsh-video-cli plaza …` — 影核广场维护命令（作者用）
 * Copyright (c) 2026 Merziller (QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com)
 *
 *   plaza review <zip|dir> [--json]
 *   plaza accept <zip|dir> [--id <id>] [--category <cat>] [--force] [--templates-dir <dir>]
 *   plaza add --project <dir> [--id <id>] [--category <cat>] [--title <t>] [--description <d>] [--tags a,b]
 *             [--author <name>] [--preview-start <sec>] [--allow-names] [--force] [--templates-dir <dir>]
 *   plaza index [--templates-dir <dir>] [--no-probe] [--json]
 * The templates folder defaults to the plugin's `templates/cinepulse-hub` (env DSH_PLAZA_TEMPLATES_DIR or
 * --templates-dir point it elsewhere, e.g. a scratch copy). Output goes to stdout (process.stdout.write).
 */
import { relative, resolve } from 'node:path'
import { acceptPlazaPackage, addProjectToBuiltinPlaza, categoryLabel, PLAZA_COMMUNITY, reviewPlazaPackage, writePlazaIndex } from './plaza-community.js'
import { getBuiltinPlazaDir, PLAZA_CATEGORIES } from './template-plaza.js'

const VALUE_FLAGS = new Set(['--id', '--category', '--templates-dir', '--project', '--title', '--description', '--tags', '--author', '--preview-start'])
const BOOL_FLAGS = new Set(['--force', '--json', '--allow-names', '--no-probe', '--help', '-h'])

function parseArgs(argv) {
  const pos = []
  const flags = {}
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i])
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1]
      if (v === undefined || String(v).startsWith('--')) throw new Error(`${a} 需要一个值`)
      flags[a.slice(2)] = String(v)
      i++
    } else if (a.startsWith('--') && a.includes('=') && VALUE_FLAGS.has(a.slice(0, a.indexOf('=')))) {
      flags[a.slice(2, a.indexOf('='))] = a.slice(a.indexOf('=') + 1)
    } else if (BOOL_FLAGS.has(a)) {
      flags[a.replace(/^-+/, '')] = true
    } else if (a.startsWith('-')) {
      throw new Error(`不认识的参数：${a}`)
    } else pos.push(a)
  }
  return { pos, flags }
}

const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`)
const pad = (s, n) => {
  const t = String(s)
  const w = Array.from(t).reduce((a, c) => a + (/[ᄀ-￿]/.test(c) ? 2 : 1), 0)
  return t + ' '.repeat(Math.max(1, n - w))
}
const rel = (p) => {
  const r = relative(process.cwd(), p)
  return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p
}
const q = (p) => (/\s/.test(p) ? `"${p}"` : p)
const CATS = () => PLAZA_CATEGORIES.filter((c) => c.id !== 'all').map((c) => `${c.id}（${categoryLabel(c.id)}）`).join('、')

export const plazaCliHelp = () => `影核广场维护命令（作者用）

  plaza review <投稿包.zip | 文件夹>          检查投稿包：文件类型 / 大小 / SHA-256 / 样片 ≤ 15 秒 / 隐私，输出中文报告
        [--json]                            以 JSON 输出结果

  plaza accept <投稿包.zip | 文件夹>          审核通过后收录为内置模板 templates/cinepulse-hub/<id>/（可直接提交）
        [--id <英文ID>] [--category <分类>]   改模板 ID / 分类
        [--force]                           已有同名模板时覆盖

  plaza add --project <工程目录>              把自己的工程直接发布进内置广场（自动截取样片 + 封面）
        [--id <英文ID>] [--category <分类>] [--title <标题>] [--description <简介>] [--tags 标签1,标签2]
        [--author <署名>] [--preview-start <秒>] [--allow-names] [--force]

  plaza index [--no-probe] [--json]           生成 templates/cinepulse-hub/index.json（在线模板目录：文件大小 + SHA-256）

  通用：--templates-dir <目录>  改用另一个模板目录（默认插件自带的 templates/cinepulse-hub，环境变量 DSH_PLAZA_TEMPLATES_DIR 同效）
  分类：${CATS()}
`

function help(out) {
  out(plazaCliHelp())
}

function printReview(out, r, src) {
  const s = r.summary
  out('影核广场 · 投稿审核报告\n')
  out('────────────────────────────────────────\n')
  out(`${pad('投稿包', 10)}${s.source}（${kb(s.bytes)}）\n`)
  if (s.id) out(`${pad('投稿编号', 10)}${s.id}\n`)
  out(`${pad('标题', 10)}${s.title || '（缺失）'}\n`)
  out(`${pad('分类', 10)}${s.category ? `${s.categoryLabel}（${s.category}）` : '（缺失）'}\n`)
  out(`${pad('作者昵称', 10)}${s.author || '（缺失）'}\n`)
  out(`${pad('联系方式', 10)}${s.contact || '（未填写）'}\n`)
  if (s.description) out(`${pad('简介', 10)}${s.description.replace(/\s+/g, ' ').slice(0, 200)}\n`)
  if (s.tags && s.tags.length) out(`${pad('标签', 10)}${s.tags.join('、')}\n`)
  if (s.createdAt || s.pluginVersion) out(`${pad('创建时间', 10)}${s.createdAt ? s.createdAt.replace('T', ' ').slice(0, 16) : '—'}${s.pluginVersion ? ` · 插件 v${s.pluginVersion}` : ''}\n`)
  out(`${pad('内容', 10)}${s.shotCount || 0} 镜 · 全片 ${Number(s.durationSec || 0).toFixed(1)} 秒${s.aspectRatio ? ` · ${s.aspectRatio}` : ''}${s.engine ? ` · ${s.engine}` : ''}\n`)
  if (s.preview) out(`${pad('样片', 10)}${s.preview.durationSec.toFixed(1)} 秒 · ${s.preview.width}×${s.preview.height} · ${s.preview.videoCodec || '?'}${s.preview.hasAudio ? ' · 有声音' : ' · 无声音'}\n`)
  out('文件\n')
  for (const f of s.files) out(`  ${f.ok ? '✓' : '✗'} ${pad(f.name, 18)}${pad(kb(f.size), 10)}${f.sha256.slice(0, 12)}…\n`)
  out(`${pad('隐私检查', 10)}${s.privacyClean ? '通过' : '未通过'}\n`)
  if (r.warnings.length) {
    out('提醒\n')
    for (const w of r.warnings) out(`  · ${w}\n`)
  }
  if (r.ok) {
    out(`${pad('结论', 10)}✅ 可以采纳。收录命令：\n`)
    out(`          node bin/dsh-video-cli.mjs plaza accept ${q(src)}${s.category ? '' : ' --category <分类>'}\n`)
  } else {
    out(`${pad('结论', 10)}❌ 不能采纳（${r.errors.length} 个问题）：\n`)
    for (const e of r.errors) out(`  · ${e}\n`)
  }
}

function nextSteps(out, dest, title, root) {
  const indexFile = rel(resolve(root, 'index.json'))
  out('下一步：\n')
  out('  1. node bin/dsh-video-cli.mjs plaza index        # 更新在线模板目录 index.json\n')
  out(`  2. git add ${q(rel(dest))} ${q(indexFile)}\n`)
  out(`  3. git commit -m "plaza: 收录「${String(title).replace(/"/g, "'")}」" && git push\n`)
  out('推送后，用户在影核广场点「刷新在线模板」即可拿到新模板，无需升级插件。\n')
}

/** Runs one `plaza` sub-command. Returns the process exit code (0 ok, 1 failed check / error, 2 usage). */
export async function runPlazaCli(argv = [], { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s) } = {}) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (e) {
    err(`${e.message}\n\n`)
    help(out)
    return 2
  }
  const { pos, flags } = parsed
  const sub = String(pos[0] || 'help').toLowerCase()
  if (sub === 'help' || flags.help || flags.h) {
    help(out)
    return 0
  }
  const templatesDir = flags['templates-dir'] ? resolve(flags['templates-dir']) : ''
  try {
    if (sub === 'review') {
      if (!pos[1]) throw Object.assign(new Error('用法：plaza review <投稿包.zip | 文件夹>'), { usage: true })
      const r = await reviewPlazaPackage(pos[1])
      if (flags.json) out(`${JSON.stringify({ ok: r.ok, errors: r.errors, warnings: r.warnings, summary: r.summary }, null, 2)}\n`)
      else printReview(out, r, pos[1])
      return r.ok ? 0 : 1
    }
    if (sub === 'accept') {
      if (!pos[1]) throw Object.assign(new Error('用法：plaza accept <投稿包.zip | 文件夹> [--id <英文ID>] [--category <分类>] [--force]'), { usage: true })
      const res = await acceptPlazaPackage(pos[1], { id: flags.id || '', category: flags.category || '', force: Boolean(flags.force), templatesDir })
      out(`✅ 已收录「${res.title}」→ ${rel(res.dest)}（模板 ID：${res.id} · 分类：${categoryLabel(res.category)}）\n`)
      for (const w of res.review.warnings) out(`  提醒：${w}\n`)
      nextSteps(out, res.dest, res.title, templatesDir || getBuiltinPlazaDir())
      return 0
    }
    if (sub === 'add') {
      if (!flags.project) throw Object.assign(new Error('用法：plaza add --project <工程目录> [--id <英文ID>] [--category <分类>] [--title <标题>]'), { usage: true })
      const res = await addProjectToBuiltinPlaza({
        projectDir: flags.project,
        id: flags.id || '',
        category: flags.category || '',
        title: flags.title || '',
        description: flags.description || '',
        tags: flags.tags || '',
        author: flags.author || '',
        previewStartSec: flags['preview-start'],
        allowNames: Boolean(flags['allow-names']),
        force: Boolean(flags.force),
        templatesDir,
        onProgress: (m) => out(`  … ${m}\n`),
      })
      out(`✅ 已发布「${res.title}」→ ${rel(res.dest)}（模板 ID：${res.id} · 分类：${categoryLabel(res.category)} · 样片 ${res.preview.durationSec} 秒）\n`)
      out(`  隐私：${res.privacy}\n`)
      nextSteps(out, res.dest, res.title, templatesDir || getBuiltinPlazaDir())
      return 0
    }
    if (sub === 'index') {
      const res = await writePlazaIndex({ templatesDir, probe: !flags['no-probe'] })
      if (flags.json) {
        out(`${JSON.stringify({ ok: res.ok, file: res.file, count: res.count, changed: res.changed, problems: res.problems }, null, 2)}\n`)
        return res.ok ? 0 : 1
      }
      out(`${res.ok ? '✅' : '⚠️'} 已写入 ${rel(res.file)}：${res.count} 个模板（${res.changed ? '内容有变化' : '内容未变化'}）\n`)
      for (const t of res.templates) out(`  · ${pad(t.id, 28)}${pad(t.files.length + ' 个文件', 10)}${pad(kb(t.totalBytes), 10)}${t.title}\n`)
      for (const p of res.problems) {
        out(`  ${p.included ? '提醒' : '✗ 未收录'} ${p.id}：\n`)
        for (const i of p.issues) out(`      - ${i}\n`)
      }
      out('提交并推送后用户即可「刷新在线模板」。jsDelivr 会缓存最长约 12 小时，想立刻生效可打开：\n')
      out(`  ${PLAZA_COMMUNITY.indexUrls[0].replace('https://cdn.jsdelivr.net/', 'https://purge.jsdelivr.net/')}\n`)
      return res.ok ? 0 : 1
    }
    err(`不认识的子命令：${sub}\n\n`)
    help(out)
    return 2
  } catch (e) {
    err(`❌ ${e?.message || e}\n`)
    if (e?.usage) return 2
    return 1
  }
}
