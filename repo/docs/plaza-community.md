# 影核广场社区：投稿 · 审核收录 · 在线模板库

> 影核广场（CinePulse Hub）是 DSH Video Workbench 的模板社区。没有任何服务器：
> **用户自己把投稿包发给作者 → 作者用命令行审核、收录进内置模板并推送到 GitHub → 所有用户点「刷新在线模板」就能拿到新模板，不用升级插件。**

```
 用户                                   作者 (Merziller)                              所有用户
 ─────────────────────────────          ─────────────────────────────────────         ───────────────────────────
 影核广场 → 投稿到影核广场               plaza review  投稿包.zip   （检查）           影核广场 → 刷新在线模板
   填信息 + 勾选授权                     plaza accept  投稿包.zip   （收录）             ↓ 只下载新的 / 有变化的模板
   看「将分享的内容」+ 隐私检查          plaza index                （生成目录）         ↓ 大小 + SHA-256 校验
   生成投稿包（zip，在本机）             git commit + push                               卡片带「在线」角标，一键套用
   GitHub 表单 / 邮件 发给作者  ───────→                         ──────────────────→
```

---

## 一、给用户：怎么投稿

### 1. 准备一个已经出片的工程
投稿包需要从成片（`output/final.mp4`）截取一段 **≤ 15 秒** 的样片，所以请先在「分步精修 → 交付」把作品渲染成片。

### 2. 打开「投稿到影核广场」
作战大屏里打开 **影核广场**，点顶部的 **投稿到影核广场** 标签（模板墙里的「去投稿」按钮也可以）。

### 3. 填写投稿信息
| 项目 | 说明 |
|---|---|
| 作品标题（必填） | 收录后显示为模板名称，最多 60 字。作者可能会微调。 |
| 分类（必填） | 历史高燃卡点 / 科技产品发布会 / SaaS · 软件教程 / 深度科普拆解 / 数据榜单洞察 / 其他。 |
| 一句话简介 | 画风、节奏、适合的题材，方便大家搜索，最多 300 字。 |
| 标签 | 逗号或空格分隔，最多 8 个。 |
| 作者昵称（必填） | 显示在模板卡片上。 |
| 联系方式（可选） | 方便作者联系你。**通过 GitHub 投稿时投稿包和 Issue 都是公开的**，不想公开就留空，或改用邮件投稿。 |
| 样片起点（可选） | 留空会自动避开片头；样片最长 15 秒。 |
| 授权声明（必选） | 授权作者在影核广场展示、整理（可调整标题、分类与简介）和分发；内容为本人原创或已获授权，不侵犯他人的版权、肖像权与隐私。 |

昵称和联系方式只记在你自己的浏览器里，下次投稿自动填好。

### 4. 看清「将分享的内容」
右侧列出投稿包里的 **全部** 文件，并且可以点开查看 `template.json` / `MOTION.md` / `script.json` 的完整内容：

| 文件 | 内容 |
|---|---|
| `template.json` | 标题、分类、简介、标签、作者昵称，以及配色、节奏、转场等风格参数 |
| `MOTION.md` | 动效蓝图：分镜表（每镜前 36 字文案）、转场与节奏 |
| `script.json` | 分镜脚本（已脱敏）：文案、画面描述与时间轴；素材只保留文件名 |
| `preview.mp4` | 样片：≤ 15 秒、最长边 ≤ 960 像素、去掉了视频元数据 |
| `cover.jpg` | 封面：成片画面截图，去掉了图片元数据 |
| `submission.json` | 投稿说明：投稿信息、授权声明、插件版本、创建时间、每个文件的 SHA-256 |

**不会分享**：素材原文件（图片 / 视频 / 音乐 / 录音）、配音与混音音频、数字人视频、API 密钥与模型设置、本机路径、电脑用户名与计算机名、工程里的其他文件。

#### 隐私检查（打包前自动进行）
- **自动清理**：本机路径（`C:\…`、`/Users/…`、`/home/…`、`file://…` 等，工程内的改成相对路径，其余只保留文件名）、API 密钥 / 令牌（`sk-…`、GitHub / AWS / Google 令牌、JWT、`token: …` 写法，以及本机设置里配置过的密钥原文）、邮箱地址（你填写的联系方式和作者的公开邮箱除外）、配音文件 / 日志 / 硬件信息等本机专用字段。清理了多少会在「隐私检查」里写明。
- **需要你确认**：如果文案里出现了你的 **电脑用户名或计算机名**，插件无法判断它是不是正常内容（比如品牌名、角色名），会打码列出位置。确认可以公开就勾选「可以公开」，否则先到工程里改掉。
- **无法清理就不打包**：最后还会对每个文件（包括样片和封面）再检查一遍，发现问题就不生成投稿包，并说明是哪个文件的哪个位置。
- 想让插件把别的词也当作隐私（例如你的真实姓名、公司内部代号），可以设置环境变量 `DSH_PLAZA_PRIVATE_WORDS=词1,词2`。

### 5. 生成投稿包
勾选授权后点 **生成投稿包**。投稿包保存在本机：

```
<DSH_VIDEO_HOME>/plaza-submissions/<投稿编号>/
  <投稿编号>.zip      ← 要发给作者的文件
  files/…            ← zip 里的同一批文件（方便你检查）
```
（`<DSH_VIDEO_HOME>` 是环境变量 `DSH_VIDEO_HOME` 指定的目录；没设置时是插件工作目录——源码目录，或安装版的 `~/.dsh/video-workbench`——下的 `.dsh-home`。）

### 6. 发给作者（三选一，都由你自己操作）
- **去 GitHub 投稿（推荐）**：打开已经填好的投稿表单（需要 GitHub 账号），把 zip 拖进「上传投稿包」框，等出现链接后提交。**GitHub 上的内容是公开的。**
- **邮件投稿**：打开你的邮件程序，标题和正文已经填好（收件人 `k26789228@gmail.com`），**请手动把 zip 作为附件加上**再发送。邮件不会公开。
- **打开投稿包所在文件夹**：在资源管理器 / 访达里选中 zip，方便拖到网页或邮件里（其他系统会显示路径）。

插件 **不会自动上传任何东西**。

### 7. 我的投稿
「我的投稿」列出本机所有投稿包：大小、创建时间、是否已投稿。可以 **再次打开**（重新查看内容、再次打开 GitHub / 邮件投稿）、**删除**，或手动 **标记为已投稿** 方便记录。

### 8. 刷新在线模板
模板墙工具栏里的 **刷新在线模板**：从作者的在线模板库下载新收录 / 更新过的模板，卡片上会显示 **「在线」** 角标（作者更新了内置模板时显示「在线更新」），和内置模板一样可以试看样片、一键套用。

- 只在你点这个按钮时联网，没有任何后台联网。
- 依次尝试 jsDelivr（`cdn.jsdelivr.net`、`fastly.jsdelivr.net`）和 GitHub（`raw.githubusercontent.com`）。
- 只下载数据文件（json / md / mp4 / jpg / png），逐个检查大小上限和 SHA-256，**从不执行下载的任何内容**。
- 某个模板下载或校验失败时保留上一次的完好版本；连不上网时提示原因，已下载的在线模板照常可用。
- 作者下架的模板，下次刷新时会从本机移除；和插件内置版本完全相同的模板不会重复下载。

---

## 二、给作者：审核 → 收录 → 生成目录 → 提交

以下命令都在插件仓库根目录运行（`node bin/dsh-video-cli.mjs plaza help` 查看全部参数）。

### 0. 第一次使用
- 在 GitHub 仓库里新建标签 `plaza-submission`（投稿表单 `.github/ISSUE_TEMPLATE/plaza-submission.yml` 会自动加上它）。
- 想先演练一遍：所有命令都支持 `--templates-dir <临时目录>`（或环境变量 `DSH_PLAZA_TEMPLATES_DIR`），先把 `templates/cinepulse-hub` 复制一份到临时目录再试，真实模板目录不会被改动。

### 1. 收到投稿
从 GitHub Issue 的附件或邮件附件下载 zip（Issue 里的「投稿包 SHA-256」可以和 `plaza review` 报告核对）。

### 2. 审核：`plaza review`
```bash
node bin/dsh-video-cli.mjs plaza review 下载目录/xxx-20261122-153000.zip
```
检查项：文件只能是 json / md / mp4 / jpg / png，大小不超上限；`submission.json` 格式、授权声明、每个文件的 SHA-256；样片 ≤ 15 秒；隐私检查（本机路径、用户文件夹、密钥、陌生邮箱）。输出一份中文报告，结论是 **✅ 可以采纳** 或 **❌ 不能采纳（列出问题）**。也可以指定解压后的文件夹；`--json` 输出机器可读结果。退出码：0 通过、1 不通过。

### 3. 收录：`plaza accept`
```bash
node bin/dsh-video-cli.mjs plaza accept 下载目录/xxx.zip                       # 用投稿里的 ID 和分类
node bin/dsh-video-cli.mjs plaza accept 下载目录/xxx.zip --id autumn-cafe --category product-promo
```
先自动再审核一遍，通过后安装到 `templates/cinepulse-hub/<id>/`（`template.json`、`MOTION.md`、`script.json`、`preview.mp4`、封面），可以直接提交。同名模板已存在时拒绝覆盖，需要覆盖加 `--force`。`template.json` 里会记录 `community`（投稿编号、投稿 / 收录时间），**不会写入投稿人的联系方式**。

### 4. 发布自己的工程：`plaza add`
```bash
node bin/dsh-video-cli.mjs plaza add --project <工程目录> --id my-new-template --category data-story --title "新模板标题"
```
可选：`--description`、`--tags 标签1,标签2`、`--author`、`--preview-start <秒>`、`--force`。同样会做隐私清理、截取 ≤ 15 秒样片和封面。内容里出现电脑用户名时需要确认（`--allow-names`）。

### 5. 生成在线目录：`plaza index`
```bash
node bin/dsh-video-cli.mjs plaza index
```
写入 `templates/cinepulse-hub/index.json`：每个模板的 ID、标题、分类、版本和每个文件的大小 + SHA-256。不合格的模板（比如样片超过 15 秒、文件类型不对）会列出原因并且不进目录。内容没变时 `generatedAt` 保持不变，不会产生无意义的提交。

### 6. 提交并推送
```bash
git add templates/cinepulse-hub/<id> templates/cinepulse-hub/index.json
git commit -m "plaza: 收录「作品标题」"
git push
```
推送后用户点「刷新在线模板」就能拿到。jsDelivr 会缓存 `@main` 最长约 12 小时，想立刻生效可以打开：
`https://purge.jsdelivr.net/gh/Merziller/dsh-video-workbench@main/templates/cinepulse-hub/index.json`

### 下架模板
删除 `templates/cinepulse-hub/<id>/` → `plaza index` → 提交推送。用户下次刷新时会自动移除这个在线模板。

---

## 三、规格（给开发者）

### 投稿包
- zip（UTF-8 文件名），文件都在一个顶层文件夹 `<投稿编号>/` 里：`template.json`、`MOTION.md`、`script.json`、`preview.mp4`、`cover.jpg`、`submission.json`。
- 投稿编号：`<标题英文 slug 或工程目录名>-YYYYMMDD-HHMMSS`。
- `submission.json`（`schema: "dsh-plaza-submission/1"`）：`id`、`templateId`、`title`、`category`、`categoryLabel`、`description`、`tags`、`author`、`contact`、`consent { agreed, text, at }`、`pluginVersion`、`createdAt`、`film`、`preview`、`privacy { checked, summary, counts }`、`files [{ name, size, sha256 }]`（除它自己以外的每个文件）。

### 文件规则
| 文件 | 类型检查 | 上限 |
|---|---|---|
| `template.json` / `submission.json` | UTF-8 JSON 对象 | 128 KB |
| `MOTION.md` | UTF-8 文本 | 512 KB |
| `script.json` | UTF-8 JSON 对象 | 4 MB |
| `preview.mp4` | MP4（`ftyp`），≤ 15 秒 | 4 MB（与 npm 发布包对内置样片的上限一致） |
| `cover.jpg` / `cover.png`（内置模板也可用 `preview.jpg` / `preview.png`） | JPG / PNG 文件头 | 4 MB |
| 投稿包 zip | 不支持 zip64、加密、符号链接、子文件夹 | 25 MB（GitHub 附件上限） |
| 单个模板合计 | — | 24 MB |

### `index.json`
`schema: "dsh-plaza-index/1"`、`plaza`、`repo`、`generatedAt`、`count`、`templates [{ id, title, category, categoryLabel, author, version, order, updatedAt, durationSec, shotCount, aspectRatio, totalBytes, files [{ name, size, sha256 }] }]`。文件下载地址 = `index.json` 所在目录 + `/<id>/<文件名>`。

### 在线同步
- 目录：`<DSH_VIDEO_HOME>/plaza-online/<id>/`（`catalog.json` 记录上次同步结果）。
- 先下载到临时文件夹，全部通过校验后整体替换旧版本；失败时删除临时文件夹、保留旧版本。
- 同一个模板 ID 既有内置版本又有在线版本时，`updatedAt` 较新的生效（相同时用内置版本）；用户自己的「我的发布」不会覆盖它们。

### 环境变量
| 变量 | 作用 |
|---|---|
| `DSH_PLAZA_TEMPLATES_DIR` | 内置模板目录（默认插件的 `templates/cinepulse-hub`）；测试 / 演练用 |
| `DSH_PLAZA_INDEX_URLS` | 在线目录地址（逗号分隔，按顺序尝试；只允许 https，或本机 http 镜像） |
| `DSH_PLAZA_REVEAL=0` | 「打开投稿包所在文件夹」只返回路径，不打开文件管理器 |
| `DSH_PLAZA_PRIVATE_WORDS` | 额外当作隐私的词（逗号分隔） |

### 接口（`/api/video-workbench/…`）
| 方法 · 路径 | 说明 |
|---|---|
| `GET plaza/submissions` | 我的投稿 + 在线模板库状态；`?id=` 单个投稿包（文件、内容、GitHub / 邮件链接）；`?id=&file=preview.mp4\|cover.jpg` 样片 / 封面（支持 Range） |
| `POST plaza/submit` | `action: "preview"` 预览将分享的内容；`"build"` 生成投稿包（后台任务，轮询 `GET jobs?id=`）；`"mark"` 标记已投稿 |
| `POST plaza/submissions/delete` | `{ id }` 删除本机投稿包 |
| `POST plaza/remote-sync` | 刷新在线模板（后台任务） |
| `POST plaza/reveal` | `{ id }` 在文件管理器里选中投稿包（只限 `plaza-submissions/` 里的投稿包） |

### 相关文件
- `packages/dsh-tool-media/plaza-community.js` — 投稿包、审核 / 收录 / 发布 / 目录、在线同步
- `packages/dsh-tool-media/plaza-privacy.js` — 隐私检查
- `packages/dsh-tool-media/plaza-cli.js` — `plaza` 命令
- `packages/dsh-tool-media/template-plaza.js` — 模板列表（内置 / 在线 / 我的发布）、套用、样片
- `packages/dsh-web-video-workbench/lib/routes-plaza.js` — 接口
- `packages/dsh-web-video-workbench/lib/warroom/kit/src/80-ops.js` — 影核广场面板
- `.github/ISSUE_TEMPLATE/plaza-submission.yml` — GitHub 投稿表单（字段 id 与插件打开表单时带的参数一致）
- `scripts/tests/plaza-community.test.mjs`、`scripts/tests/plaza-ui.e2e.mjs` — 测试
