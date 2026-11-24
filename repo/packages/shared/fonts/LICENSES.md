# Bundled Open-Source Commercial Fonts License

All fonts bundled under `packages/shared/fonts/` are licensed under the **SIL Open Font License, Version 1.1 (OFL-1.1)** and are free for commercial and non-commercial video distribution without font-seat fees or copyright claims.

## Included Font Files

1. **Noto Sans SC (`NotoSansSC-VF.woff2`)** — Variable Weight (`100`–`900`)
   - Copyright: Adobe / Google Noto Project (Source Han Sans / 思源黑体)
   - License: SIL Open Font License 1.1 (`http://scripts.sil.org/OFL`)
2. **Source Han Serif SC Heavy (`SourceHanSerifSC-Heavy.woff2`)** — Display Serif Heavy (`900`)
   - Copyright: Adobe / Google (Source Han Serif / 思源宋体)
   - License: SIL Open Font License 1.1 (`http://scripts.sil.org/OFL`)

## Policy Note

Windows system fonts such as `Microsoft YaHei` (微软雅黑) and `SimHei` / `SimSun` require separate commercial font distribution licenses when embedded or sold commercially. `dsh-video-workbench` defaults to bundled **Noto Sans SC** and **Source Han Serif SC** for all HTML5 and Remotion video templates, while flagging non-OFL commercial fonts in `video_lint`.
