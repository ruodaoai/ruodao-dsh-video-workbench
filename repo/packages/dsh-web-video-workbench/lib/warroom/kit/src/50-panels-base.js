/* ============================================================================================================
 * PK · base panels — 工程 (projects / newProject), 帮助 (help) and the hidden 组件样板 (kitchen) used by skin authors
 * These are also the reference implementations for panel authors (see KIT.md).
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  /* ---------------------------------------------------------------- 工程 · 打开 / 切换 / 删除 */
  PK.panel('projects', {
    title: '视频工程',
    en: 'PROJECTS · 打开 / 切换 / 新建 / 删除',
    idx: 'PJ',
    icon: 'folder',
    kind: 'drawer',
    size: 'md',
    group: 'main',
    order: 5,
    desc: '打开、切换、新建或删除工程',
    aliases: { project: {}, openProject: {} },
    watch: (st) => [st && st.project && st.project.dir, ((st && st.projects) || []).map((p) => [p.dir, p.title, p.updatedAt, p.hasMp4])],
    render(ctx) {
      const st = PK.state || {}
      const list = Array.isArray(st.projects) ? st.projects : []
      const cur = PK.dir()
      const q = String(ctx.local.q || '').trim().toLowerCase()
      const shown = q ? list.filter((p) => `${p.title} ${p.dir}`.toLowerCase().includes(q)) : list
      ctx.foot([ui.hint(`共 ${list.length} 个工程`), ui.spacer(), ui.btn('新建工程', () => PK.open('newProject'), { kind: 'primary', icon: 'plus' })])
      return [
        list.length > 6
          ? ui.input({ key: 'pj-q', value: ctx.local.q || '', placeholder: '搜索工程名称…', type: 'search', onInput: (v) => {
              ctx.local.q = v
              ctx.update()
            } })
          : null,
        list.length
          ? ui.list(
              shown.map((p, i) =>
                ui.item({
                  key: `pj-${p.dir}`,
                  lead: String(i + 1).padStart(2, '0'),
                  title: p.title || U.baseName(p.dir),
                  sub: [p.engine === 'html' ? 'HTML5 引擎' : 'Remotion 引擎', p.hasMp4 ? '已出成片' : '未出片', p.updatedAt ? `更新于 ${U.fmtTime(p.updatedAt)}` : ''].filter(Boolean).join(' · '),
                  active: p.dir === cur,
                  onClick: p.dir === cur ? null : async () => {
                    await PK.run(async () => {
                      await PK.action('selectProject', { dir: p.dir })
                      PK.store.invalidate()
                      PK.toast(`已切换到「${p.title}」`, 'success')
                      ctx.close()
                    })
                  },
                  right: [
                    p.dir === cur ? ui.pill('当前', 'acc') : null,
                    ui.iconBtn('trash', async () => {
                      const ok = await PK.confirm({
                        title: '删除工程？',
                        text: `将永久删除工程「${p.title}」及其全部素材、配音与成片文件，无法恢复。`,
                        ok: '永久删除',
                        danger: true,
                      })
                      if (!ok) return
                      await PK.action('deleteProject', { dir: p.dir })
                      PK.store.invalidate()
                      PK.toast('工程已删除', 'success')
                    }, { title: '删除工程', kind: 'ghost' }),
                  ],
                }),
              ),
            )
          : ui.empty({ icon: 'folder', title: '还没有视频工程', text: '新建一个工程，导入素材或写一句创意，就能一键出片。', actions: [ui.btn('新建工程', () => PK.open('newProject'), { kind: 'primary', icon: 'plus' })] }),
        q && !shown.length ? ui.hint('没有匹配的工程') : null,
      ]
    },
  })

  PK.panel('newProject', {
    title: '新建视频工程',
    en: 'NEW PROJECT',
    idx: 'NEW',
    icon: 'plus',
    kind: 'modal',
    size: 'md',
    group: 'hidden',
    aliases: { createProject: {} },
    mount(ctx) {
      const d = (PK.state && PK.state.director) || {}
      ctx.local.form = {
        title: '',
        engine: d.engine || 'remotion',
        aspectRatio: d.aspectRatio || 'auto',
        quality: d.quality || '1080p',
        style: 'auto', // new projects: 「AI 自由匹配」 (the AI picks a preset or designs a style for the topic)
      }
    },
    render(ctx) {
      const f = ctx.local.form
      const opts = (PK.state && PK.state.options) || {}
      const create = async () => {
        const title = String(f.title || '').trim()
        const d = await PK.action('createProject', { title, options: { engine: f.engine, aspectRatio: f.aspectRatio, quality: f.quality, style: f.style } }, { timeout: 120000 })
        PK.store.invalidate()
        ctx.close()
        PK.emit('project-created', d && d.dir)
      }
      ctx.foot([ui.spacer(), ui.btn('取消', () => ctx.close(), { kind: 'ghost' }), ui.btn('创建并打开', create, { kind: 'primary', icon: 'check', busyText: '创建中…' })])
      return [
        ui.field(
          { label: '工程名称', en: 'TITLE', hint: '留空会自动命名，之后也可以在导演参数里修改成片标题' },
          ui.input({ key: 'np-title', value: f.title, placeholder: '例如：秋日咖啡馆新品宣传', maxLength: 120, onInput: (v) => (f.title = v), onEnter: () => create().catch(PK.reportError) }),
        ),
        ui.field({ label: '渲染引擎', en: 'ENGINE' }, ui.seg({ value: f.engine, options: opts.engines || [{ value: 'remotion', label: 'Remotion' }, { value: 'html', label: 'HTML5' }], onChange: (v) => (f.engine = v) })),
        ui.grid(
          [
            ui.field({ label: '画幅比例', en: 'ASPECT' }, ui.select({ value: f.aspectRatio, options: opts.aspectRatios || [], onChange: (v) => (f.aspectRatio = v) })),
            ui.field({ label: '成片画质', en: 'QUALITY' }, ui.select({ value: f.quality, options: opts.qualities || [], onChange: (v) => (f.quality = v) })),
          ],
          { min: 200 },
        ),
        ui.field({ label: '视觉风格', en: 'STYLE' }, ui.chips({ value: f.style, options: opts.styleCards || opts.styles || [], onChange: (v) => (f.style = v) })),
      ]
    },
  })

  /* ---------------------------------------------------------------- 帮助 */
  PK.panel('help', {
    title: '使用帮助',
    en: 'HELP · 三步出片与快捷键',
    idx: '?',
    icon: 'help',
    kind: 'modal',
    size: 'md',
    group: 'settings',
    order: 99,
    desc: '三步出片、快捷键与常见问题',
    render(ctx) {
      ctx.foot([ui.spacer(), ui.btn('知道了', () => ctx.close(), { kind: 'primary' })])
      const keys = (PK.cfg.shortcuts || [
        ['R', '一键出片 / 继续'],
        ['空格', '播放 / 暂停预览'],
        ['Esc', '关闭弹窗 / 返回'],
        ['Ctrl + Enter', '在大号编辑器里保存'],
      ]).map(([k, d]) => [h('kbd.pk-kbd', null, k), d])
      return [
        ui.section(
          { title: '三步出片', en: 'QUICK START' },
          ui.steps([
            { label: '新建或打开工程', sub: '左上角工程菜单', state: 'todo' },
            { label: '导入素材 / 写一句创意', sub: '点主题输入框可放大编辑', state: 'todo' },
            { label: '一键出片', sub: '8 位 AI Agent 协同完成', state: 'todo' },
          ]),
        ),
        ui.section({ title: '快捷键', en: 'SHORTCUTS' }, ui.kv(keys.map(([k, d]) => [k, d]))),
        ui.section(
          { title: '常见问题', en: 'FAQ' },
          ui.list([
            ui.item({ icon: 'key', title: '提示「未配置 AI 大模型」', sub: '打开「设置 · 模型与密钥」填入 API Key；或把创作模式改为「本地极速草稿」零配置出片。', onClick: () => PK.open('keys', { tab: 'llm' }) }),
            ui.item({ icon: 'voice', title: '配音没有声音 / 引擎未就绪', sub: '在「设置 · 模型与密钥 → 配音引擎」检测并一键安装本地 TTS。', onClick: () => PK.open('keys', { tab: 'tts' }) }),
            ui.item({ icon: 'cpu', title: '电脑比较卡', sub: '打开「算力体检」开启低配保护：自动降帧、关闭重特效。', onClick: () => PK.open('hardware') }),
          ]),
        ),
      ]
    },
  })

  /* ---------------------------------------------------------------- 组件样板 (for skin authors; hidden) */
  PK.panel('kitchen', {
    title: '组件样板',
    en: 'PANEL KIT · 全部原生组件',
    idx: 'KS',
    icon: 'grid',
    kind: 'modal',
    size: 'xl',
    group: 'hidden',
    mount(ctx) {
      ctx.local = { tab: 'a', seg: 'b', tog: true, sel: 'v3', chips: ['x'], txt: '这是一段可以自动增高的说明文字。\n第二行内容。', name: '超长的名称超长的名称超长的名称超长的名称超长的名称超长的名称超长的名称', sl: 42 }
    },
    render(ctx) {
      const L = ctx.local
      ctx.foot([ui.hint('底栏说明文字'), ui.spacer(), ui.btn('次要', null), ui.btn('危险', null, { kind: 'danger' }), ui.btn('主要操作', () => U.sleep(800), { kind: 'primary', icon: 'check', busyText: '处理中…' })])
      const opts = Array.from({ length: 24 }, (_, i) => ({ value: `v${i}`, label: `选项 ${i + 1}`, hint: i % 3 ? '' : '附加说明' }))
      return [
        ui.tabs({ value: L.tab, items: [{ value: 'a', label: '标签一', icon: 'film' }, { value: 'b', label: '标签二', badge: 3 }, { value: 'c', label: '标签三' }], onChange: (v) => ((L.tab = v), ctx.render()) }),
        ui.split(
          [
            ui.section(
              { title: '表单', en: 'FORM', actions: [ui.btn('操作', null, { size: 'sm' })] },
              ui.field({ label: '单行输入', en: 'INPUT', hint: '说明文字' }, ui.input({ key: 'k-name', value: L.name, onInput: (v) => (L.name = v) })),
              ui.field({ label: '多行（自动增高，可放大编辑）', en: 'TEXTAREA' }, ui.textarea({ key: 'k-txt', value: L.txt, maxLength: 500, onInput: (v) => (L.txt = v) })),
              ui.grid([
                ui.field({ label: '下拉', en: 'SELECT' }, ui.select({ value: L.sel, options: opts, onChange: (v) => (L.sel = v) })),
                ui.field({ label: '分段', en: 'SEG' }, ui.seg({ value: L.seg, options: [{ value: 'a', label: '自动' }, { value: 'b', label: '手动' }, { value: 'c', label: '关闭' }], onChange: (v) => (L.seg = v) })),
              ]),
              ui.field({ label: '滑块', en: 'SLIDER' }, ui.slider({ value: L.sl, min: 0, max: 100, format: (v) => `${v}%`, onChange: (v) => (L.sl = v) })),
              ui.toggle({ value: L.tog, label: '开关', hint: '附加说明', onChange: (v) => (L.tog = v) }),
              ui.check({ value: true, label: '复选框' }),
              ui.field({ label: '标签多选', en: 'CHIPS' }, ui.chips({ multi: true, value: L.chips, options: [{ value: 'x', label: '科技' }, { value: 'y', label: '温暖' }, { value: 'z', label: '史诗' }], onChange: (v) => (L.chips = v) })),
              ui.drop({ label: '拖入文件，或点击选择', hint: '图片 / 视频 / 音频', onFiles: async (f) => PK.toast(`选择了 ${f.length} 个文件`, 'info') }),
            ),
          ],
          [
            ui.section(
              { title: '状态', en: 'STATUS', count: 5 },
              ui.row([ui.pill('就绪', 'ok', { dot: true }), ui.pill('警告', 'warn'), ui.pill('失败', 'err'), ui.pill('强调', 'acc'), ui.pill('默认')]),
              ui.meter(64, { label: '渲染进度' }),
              ui.meter(30, { indeterminate: true }),
              ui.note('这是一条提示信息，可以很长很长并自动换行，不会遮挡其他内容。', { level: 'info', title: '提示' }),
              ui.note('出错时的说明', { level: 'error', title: '失败', actions: [ui.btn('重试', null, { size: 'sm', icon: 'retry' })] }),
              ui.kv([['分辨率', '1920 × 1080'], ['帧率', '30 fps'], ['很长的值', 'D:/very/long/path/to/some/project/output/final-video-v3.mp4']]),
              ui.row([ui.stat('92', '体检得分'), ui.stat('61', '分镜'), ui.stat('2:22', '时长')]),
            ),
            ui.section(
              { title: '列表', en: 'LIST' },
              ui.list([
                ui.item({ lead: '01', title: '第一项标题', sub: '副标题说明 · 更多信息', right: [ui.pill('当前', 'acc')], active: true, onClick: () => {} }),
                ui.item({ lead: '02', title: '超长标题超长标题超长标题超长标题超长标题超长标题超长标题超长标题', sub: '副标题也很长很长很长很长很长很长很长很长很长很长很长很长很长', right: [ui.btn('操作', null, { size: 'sm' })], onClick: () => {} }),
                ui.item({ icon: 'voice', title: '带图标的项', sub: '说明', right: [ui.playBtn(() => '')] }),
              ]),
            ),
          ],
        ),
        ui.section(
          { title: '卡片', en: 'CARDS' },
          ui.grid(
            [1, 2, 3, 4].map((i) =>
              ui.card({
                media: h('div', { style: { width: '100%', height: '100%', background: `linear-gradient(135deg, hsl(${i * 60},60%,40%), hsl(${i * 60 + 40},60%,20%))` } }),
                aspect: '16/9',
                badge: i === 1 ? '推荐' : null,
                title: `卡片标题 ${i}`,
                sub: '一句话描述卡片内容，可以换行显示完整',
                tags: ['标签', '16:9'],
                actions: [ui.btn('预览', null, { size: 'sm', icon: 'play' }), ui.btn('套用', null, { size: 'sm', kind: 'primary' })],
                active: i === 2,
                onClick: () => {},
              }),
            ),
            { min: 200 },
          ),
        ),
        ui.section(
          { title: '表格 / 日志 / 代码', en: 'TABLE · LOG · CODE' },
          ui.table({ columns: [{ key: 'a', label: '名称' }, { key: 'b', label: '状态', render: (r) => ui.pill(r.b, r.b === '成功' ? 'ok' : 'err') }, { key: 'c', label: '时间', align: 'right' }], rows: [{ a: '任务一', b: '成功', c: '今天 10:00' }, { a: '任务二', b: '失败', c: '昨天 09:12' }] }),
          ui.log([{ ts: new Date().toISOString(), level: 'info', tag: '导演', text: '分镜完成 · 24 幕' }, { ts: new Date().toISOString(), level: 'warn', tag: '配音', text: '第 3 幕重试一次' }, { ts: new Date().toISOString(), level: 'error', tag: '渲染', text: 'tsc 报错，已自动修复' }]),
          ui.code('{\n  "title": "示例",\n  "fps": 30\n}'),
        ),
        ui.empty({ icon: 'film', title: '空状态标题', text: '空状态说明文字', actions: [ui.btn('主要操作', null, { kind: 'primary' })] }),
        ui.row([
          ui.btn('打开大号编辑器', () => PK.editTopic({ allowRun: false }), { icon: 'expand' }),
          ui.btn('确认框', () => PK.confirm({ title: '确认删除？', text: '此操作无法撤销', danger: true })),
          ui.btn('输入框', () => PK.prompt({ title: '重命名', label: '名称', value: 'abc' })),
          ui.btn('提示', () => PK.toast('普通提示消息', 'info')),
          ui.btn('成功', () => PK.toast('操作成功', 'success')),
          ui.btn('错误', () => PK.toast('出错了：网络超时', 'error', { detail: 'stack…', action: { label: '重试', onClick: () => {} } })),
          ui.btn('菜单', (ev, b) => PK.menu(b, [{ label: '编辑', icon: 'edit', onClick: () => {} }, { label: '复制', icon: 'copy', onClick: () => {} }, '-', { label: '删除', icon: 'trash', danger: true, onClick: () => {} }])),
        ]),
      ]
    },
  })
})()
