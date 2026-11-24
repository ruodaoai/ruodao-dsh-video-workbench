# 作战大屏皮肤源码（design prototypes）

插件前端只渲染 `packages/dsh-web-video-workbench/lib/warroom/` 里的三个皮肤文件，这个目录保存生成它们的源码。

| 皮肤 | 原型 | 源码 | 重新生成 |
| --- | --- | --- | --- |
| 棱镜实验室 `prism-lab`（默认） | `prism-lab/index.html` | `prism-lab/port/src/`（`css/`、`js/` 按文件名顺序拼接） | `node design-prototypes/prism-lab/port/build.mjs` |
| 星舰 `nova-deck` | `nova-deck/index.html` | `nova-deck/src/`（`head.html`、`body.html`、`css/`、`js/`） | `node design-prototypes/nova-deck/src/build.mjs` |
| 墨韵 `ink-loom` | `ink-loom/index.html` | `ink-loom/_port/`：基线快照 `bak/…35-kit-wire.html` + 补丁 `NN-*.txt`（NN ≥ 35） | `node design-prototypes/ink-loom/_port/rebuild.cjs`（`--verify` 只比对不写入） |

- 三个皮肤共用的面板组件库在 `packages/dsh-web-video-workbench/lib/warroom/kit/`（说明见 `KIT.md`，宿主通信协议见 `../BRIDGE.md`）。改完组件库运行 `node packages/dsh-web-video-workbench/lib/warroom/kit/build.mjs`。
- 墨韵新增改动：写一个新的补丁文件 `ink-loom/_port/40-xxx.txt`（补丁语法见 `apply.cjs` 文件头），用 `node design-prototypes/ink-loom/_port/apply.cjs <补丁>` 应用；`rebuild.cjs` 会按顺序重放全部补丁。
- `_shared/harness.html?skin=<id>` 用示例数据单独加载一个皮肤，方便调样式；`_shared/PORTING-BRIEF.md` 是移植规范。
- 改完任何皮肤都跑一遍验收：`node scripts/tests/warroom-ui.e2e.mjs --gpu`（全部面板 × 多种窗口尺寸，检查文字遮挡、溢出和控制台报错）。

移植过程中的截图、探针脚本、备份和进度笔记只保留在本地（见 `.gitignore`），不进版本库。
