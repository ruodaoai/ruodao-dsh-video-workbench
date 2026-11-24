/* eslint-disable no-undef */
/**
 * DSH Video Workbench Frontend Client (v0.4.0 — Universal Multi-Agent & Reference Remake Studio)
 * Copyright (c) 2026 Merziller
 * Author: Merziller | QQ: 1411574209 | WeChat: Merziller | Email: k26789228@gmail.com
 * Official Repo: https://github.com/Merziller/dsh-video-workbench (MIT License)
 * Pure ES Module loaded dynamically inside DSH Web UI or Standalone Browser Studio via window.__ModuleLoader__.
 */
window.__ModuleLoader__?.load({
  id: 'dsh-video-workbench',
  factory: (resolveModule) => {
    const ReactMod = resolveModule('react')
    const React = ReactMod?.default || ReactMod
    const { useState, useEffect, useRef, useMemo, useCallback } = React
    const h = React.createElement

    // =========================================================================
    // 1. UNIFIED VISUAL TOKENS, THEMES & STATIC CATALOGS
    // =========================================================================
    const DARK_THEME = {
      mode: 'dark',
      bgRoot: '#06080E',
      bgPanel: 'rgba(13, 18, 30, 0.84)',
      bgPanelSolid: '#0E1422',
      bgElevated: 'rgba(20, 27, 45, 0.78)',
      bgInput: 'rgba(8, 12, 22, 0.88)',
      bgSidebar: 'rgba(10, 14, 24, 0.90)',
      bgHover: 'rgba(255, 255, 255, 0.06)',
      monitorShell: '#04060A',
      borderSubtle: 'rgba(148, 163, 184, 0.16)',
      borderStrong: 'rgba(148, 163, 184, 0.30)',
      textPrimary: '#F1F5F9',
      textSecondary: '#CBD5E1',
      textMuted: '#94A3B8',
      accentGold: '#F5B942',
      accentGoldBg: 'rgba(245, 185, 66, 0.14)',
      accentGoldBorder: 'rgba(245, 185, 66, 0.45)',
      accentBlue: '#22D3EE',
      accentBlueBg: 'rgba(34, 211, 238, 0.13)',
      accentBlueBorder: 'rgba(34, 211, 238, 0.42)',
      accentViolet: '#A78BFA',
      accentVioletBg: 'rgba(167, 139, 250, 0.14)',
      accentGreen: '#34D399',
      accentGreenBg: 'rgba(52, 211, 153, 0.13)',
      accentRed: '#FB7185',
      accentRedBg: 'rgba(251, 113, 133, 0.14)',
      shadowCard: '0 20px 54px rgba(0, 0, 0, 0.56)',
      shadowPopover: '0 24px 64px rgba(0, 0, 0, 0.72)',
      scrollThumb: 'rgba(148, 163, 184, 0.28)',
    }

    const LIGHT_THEME = {
      mode: 'light',
      bgRoot: '#EEF3FA',
      bgPanel: 'rgba(255, 255, 255, 0.88)',
      bgPanelSolid: '#FFFFFF',
      bgElevated: 'rgba(243, 247, 253, 0.90)',
      bgInput: 'rgba(255, 255, 255, 0.96)',
      bgSidebar: 'rgba(248, 250, 254, 0.94)',
      bgHover: 'rgba(15, 23, 42, 0.05)',
      monitorShell: '#0F172A',
      borderSubtle: 'rgba(15, 23, 42, 0.11)',
      borderStrong: 'rgba(15, 23, 42, 0.24)',
      textPrimary: '#0F172A',
      textSecondary: '#334155',
      textMuted: '#64748B',
      accentGold: '#B45309',
      accentGoldBg: 'rgba(217, 119, 6, 0.11)',
      accentGoldBorder: 'rgba(217, 119, 6, 0.36)',
      accentBlue: '#0284C7',
      accentBlueBg: 'rgba(2, 132, 199, 0.10)',
      accentBlueBorder: 'rgba(2, 132, 199, 0.35)',
      accentViolet: '#7C3AED',
      accentVioletBg: 'rgba(124, 58, 237, 0.10)',
      accentGreen: '#059669',
      accentGreenBg: 'rgba(5, 150, 105, 0.10)',
      accentRed: '#E11D48',
      accentRedBg: 'rgba(225, 29, 72, 0.10)',
      shadowCard: '0 14px 36px rgba(15, 23, 42, 0.09)',
      shadowPopover: '0 18px 46px rgba(15, 23, 42, 0.18)',
      scrollThumb: 'rgba(15, 23, 42, 0.20)',
    }

    const CLEAN_DUAL_BACKDROP = {
      dark:
        'radial-gradient(ellipse 85% 55% at 15% 12%, rgba(34,211,238,0.13), transparent 58%), radial-gradient(ellipse 75% 50% at 88% 18%, rgba(245,185,66,0.10), transparent 58%), #06080E',
      light:
        'radial-gradient(ellipse 85% 55% at 15% 12%, rgba(56,189,248,0.13), transparent 58%), radial-gradient(ellipse 75% 50% at 88% 18%, rgba(245,158,11,0.10), transparent 58%), linear-gradient(180deg, #F3F7FC 0%, #E9F0F9 100%)',
    }

    // =========================================================================
    // 1b. SWITCHABLE AI WAR-ROOM SKINS (三合一作战大屏皮肤 · contract: lib/warroom/BRIDGE.md)
    // Each skin is a self-contained HTML document served by the plugin and embedded in a same-origin
    // <iframe>; it only renders the WarRoomState the host pushes and sends user intents back as actions.
    // =========================================================================
    const WARROOM_SKINS = [
      { id: 'nova-deck', short: 'A', name: '星舰剪辑甲板', en: 'NOVA DECK', tone: 'dark', bg: '#05070F', swatch: '#3BE7FF' },
      { id: 'ink-loom', short: 'B', name: '墨韵织机', en: 'INK LOOM', tone: 'dark', bg: '#0E0D0B', swatch: '#D4A64A' },
      { id: 'prism-lab', short: 'C', name: '棱镜实验室', en: 'PRISM LAB', tone: 'light', bg: '#F2F1EC', swatch: '#2F37FF' },
    ]
    // 棱镜实验室 is the default skin. The legacy React "classic" war room and its panels have been removed: every
    // panel (分步精修 / 任务中心 / 影核广场 / 设置 …) is now a native panel inside the skin (lib/warroom/kit).
    const WARROOM_DEFAULT_SKIN = 'prism-lab'
    // v2 key: earlier builds stored 'classic' / test picks under the v1 key — everyone starts once on the new default
    const WARROOM_SKIN_STORAGE_KEY = 'dsh-vw-warroom-skin-v2'
    const WARROOM_READY_TIMEOUT_MS = 9000
    const WARROOM_AGENT_DEFS = [
      ['director', '策划导演', 'DIRECTOR'],
      ['editor', '素材剪辑', 'EDITOR'],
      ['audio', '配音混音', 'AUDIO'],
      ['motion', '动效编程', 'MOTION CODER'],
      ['qa', '质检渲染', 'QA · RENDER'],
      ['avatar', '数字人', 'AVATAR'],
      ['cloud', '云端生成', 'CLOUD GEN'],
      ['reference', '参考复刻', 'REFERENCE'],
    ]
    const WARROOM_TASK_AGENT = { 't-director': 'director', 't-editor': 'editor', 't-audio': 'audio', 't-avatar': 'avatar', 't-motion': 'motion', 't-render': 'qa' }
    // Panel-kit bridge (`api` / `upload` actions, see lib/warroom/BRIDGE.md §4b): the native in-skin panels may call
    // exactly these plugin routes (paths relative to /api/video-workbench/). Project create/delete and the pipeline
    // start go through dedicated actions so the host keeps its own state in sync.
    const KIT_API_GET = new Set([
      'state', 'hardware', 'jobs', 'llm-config', 'tts-config', 'code', 'safe-zone', 'tasks', 'avatar/config', 'avatar/lipsync',
      'tts/install-options', 'brand-kit', 'cloud-media', 'cloud-media/staging', 'plaza/templates', 'plaza/template', 'color-lut',
      'project/history', 'project/scene-edits', 'project/characters', 'project/cloud-jobs',
      'publish-pack/cover', 'plaza/submissions', 'style-presets',
    ])
    const KIT_API_POST = new Set([
      'hardware', 'llm-config', 'llm-test', 'tts-config', 'tts-test', 'script', 'assets/import', 'assets/delete', 'assets/role',
      'assets/curate', 'assets/starter-pack', 'assets/recording', 'plan', 'produce', 'ai-produce', 'ai-refine', 'qa', 'voices/import',
      'voices/clone-upload', 'voices/delete', 'voices/clone-preview', 'voices/match', 'audio/llm-compose', 'audio/tts-compose',
      'publish-pack', 'vendor/import', 'action', 'tasks/control', 'teleprompter/generate', 'avatar/generate', 'avatar/config',
      'avatar/lipsync/install', 'polish-topic', 'tts/install', 'tts/repair-voices', 'reference/analyze', 'reference/clear',
      'brand-kit', 'motion-md', 'cloud-media', 'cloud-media/generate', 'cloud-media/assist-prompt', 'cloud-media/staging/commit',
      'cloud-media/staging/discard', 'plaza/apply', 'plaza/publish', 'export', 'scopes', 'color-lut', 'qa-deep',
      'project/history/diff', 'project/history/restore', 'project/history/snapshot', 'project/history/prune', 'project/scene-lock',
      'project/scene-overrides', 'project/scene-overrides/batch', 'project/characters/save', 'project/characters/delete',
      'project/characters/attach', 'project/stock/search', 'project/stock/import', 'project/refine',
      'publish-pack/cover', 'plaza/submit', 'plaza/submissions/delete', 'plaza/remote-sync', 'plaza/reveal',
      'style-presets/save', 'style-presets/rename', 'style-presets/delete',
    ])
    // POSTs that only read / preview — no host refresh afterwards
    const KIT_API_NO_REFRESH = new Set([
      'llm-test', 'tts-test', 'voices/clone-preview', 'cloud-media/assist-prompt', 'polish-topic', 'teleprompter/generate',
      'project/history/diff', 'project/stock/search', 'scopes', 'qa-deep',
      'plaza/submit', 'plaza/submissions/delete', 'plaza/reveal',
    ])
    // Raw binary uploads (body = file bytes, metadata in the query string)
    const KIT_UPLOAD_PATHS = new Set(['assets/upload', 'bgm/upload', 'reference/upload', 'skin/upload'])



    // A stringified missing value ("undefined" / "null") is never a real brief — neither the whole text nor a
    // 【marker】 whose value is only that (an old skin bug stored briefs like 「【一句话】undefined」, sometimes flattened
    // to one line). Same rule as dropMissingBriefValues in packages/shared/meta-guard.js.
    function cleanBriefText(v) {
      const s = String(v ?? '').slice(0, 8000)
      if (/^\s*(undefined|null)\s*$/i.test(s)) return ''
      return s
        .replace(/^[ \t]*【[^】\r\n]{1,20}】[ \t]*(?:undefined|null)[ \t]*(?:\r?\n|$)/gim, '')
        .replace(/【[^】\r\n]{1,20}】[ \t]*(?:undefined|null)[ \t]*(?=【|\r?\n|$)/gi, '')
    }

    function readStoredWarSkin() {
      try {
        const saved = localStorage.getItem(WARROOM_SKIN_STORAGE_KEY)
        if (WARROOM_SKINS.some((s) => s.id === saved)) return saved
      } catch {}
      return WARROOM_DEFAULT_SKIN
    }

    // Skin-tinted variants of the React theme, so 分步精修 / 任务中心 / every modal matches the chosen skin.
    const SKIN_THEME_PATCHES = {
      'nova-deck': {
        dark: {
          bgRoot: '#05070F',
          bgPanel: 'rgba(13, 19, 51, 0.84)',
          bgPanelSolid: '#0C1231',
          bgElevated: 'rgba(21, 30, 74, 0.78)',
          bgInput: 'rgba(6, 9, 27, 0.9)',
          bgSidebar: 'rgba(8, 11, 31, 0.92)',
          monitorShell: '#03050C',
          borderSubtle: 'rgba(59, 231, 255, 0.14)',
          borderStrong: 'rgba(59, 231, 255, 0.28)',
          textPrimary: '#E8F1FF',
          textSecondary: '#C6D2F0',
          textMuted: '#93A2CC',
          accentBlue: '#3BE7FF',
          accentBlueBg: 'rgba(59, 231, 255, 0.13)',
          accentBlueBorder: 'rgba(59, 231, 255, 0.44)',
          accentGold: '#FFB547',
          accentGoldBg: 'rgba(255, 181, 71, 0.14)',
          accentGoldBorder: 'rgba(255, 181, 71, 0.45)',
          scrollThumb: 'rgba(59, 231, 255, 0.26)',
        },
        light: {},
        backdrop: {
          dark: 'radial-gradient(ellipse 85% 55% at 15% 10%, rgba(59,231,255,0.14), transparent 58%), radial-gradient(ellipse 70% 50% at 90% 16%, rgba(255,79,216,0.08), transparent 60%), linear-gradient(180deg, #070A1C 0%, #05070F 100%)',
        },
      },
      'ink-loom': {
        dark: {
          bgRoot: '#0E0D0B',
          bgPanel: 'rgba(26, 24, 20, 0.88)',
          bgPanelSolid: '#1A1814',
          bgElevated: 'rgba(38, 34, 27, 0.82)',
          bgInput: 'rgba(15, 13, 10, 0.9)',
          bgSidebar: 'rgba(21, 19, 15, 0.94)',
          bgHover: 'rgba(237, 227, 207, 0.06)',
          monitorShell: '#0A0907',
          borderSubtle: 'rgba(237, 227, 207, 0.12)',
          borderStrong: 'rgba(212, 166, 74, 0.32)',
          textPrimary: '#EDE3CF',
          textSecondary: '#D6CAB2',
          textMuted: '#A69C89',
          accentGold: '#D4A64A',
          accentGoldBg: 'rgba(212, 166, 74, 0.14)',
          accentGoldBorder: 'rgba(212, 166, 74, 0.46)',
          accentBlue: '#8FB8C9',
          accentBlueBg: 'rgba(143, 184, 201, 0.13)',
          accentBlueBorder: 'rgba(143, 184, 201, 0.42)',
          accentGreen: '#7FA99B',
          accentGreenBg: 'rgba(127, 169, 155, 0.14)',
          accentRed: '#E0573E',
          accentRedBg: 'rgba(224, 87, 62, 0.14)',
          scrollThumb: 'rgba(212, 166, 74, 0.28)',
        },
        light: {},
        backdrop: {
          dark: 'radial-gradient(ellipse 80% 55% at 14% 8%, rgba(212,166,74,0.13), transparent 60%), radial-gradient(ellipse 70% 50% at 88% 20%, rgba(200,54,29,0.08), transparent 60%), linear-gradient(180deg, #12100D 0%, #0E0D0B 100%)',
        },
      },
      'prism-lab': {
        light: {
          bgRoot: '#F2F1EC',
          bgPanel: 'rgba(250, 250, 247, 0.9)',
          bgPanelSolid: '#FAFAF7',
          bgElevated: 'rgba(255, 255, 255, 0.86)',
          bgInput: 'rgba(255, 255, 255, 0.96)',
          bgSidebar: 'rgba(250, 250, 247, 0.94)',
          bgHover: 'rgba(17, 17, 17, 0.05)',
          borderSubtle: 'rgba(17, 17, 17, 0.11)',
          borderStrong: 'rgba(17, 17, 17, 0.22)',
          textPrimary: '#111111',
          textSecondary: '#3A3A37',
          textMuted: '#6B6A64',
          accentBlue: '#2F37FF',
          accentBlueBg: 'rgba(47, 55, 255, 0.09)',
          accentBlueBorder: 'rgba(47, 55, 255, 0.32)',
          accentGold: '#C2410C',
          accentGoldBg: 'rgba(255, 90, 31, 0.10)',
          accentGoldBorder: 'rgba(255, 90, 31, 0.36)',
          accentGreen: '#1A8F42',
          accentGreenBg: 'rgba(31, 163, 74, 0.10)',
          accentRed: '#D92D20',
          accentRedBg: 'rgba(217, 45, 32, 0.09)',
          scrollThumb: 'rgba(17, 17, 17, 0.2)',
        },
        dark: {
          bgRoot: '#0E0F11',
          bgPanelSolid: '#15161A',
          accentBlue: '#7C83FF',
          accentBlueBg: 'rgba(124, 131, 255, 0.14)',
          accentBlueBorder: 'rgba(124, 131, 255, 0.42)',
        },
        backdrop: {
          light: 'linear-gradient(rgba(17,17,17,0.026) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, rgba(17,17,17,0.026) 1px, transparent 1px) 0 0 / 32px 32px, radial-gradient(ellipse 80% 55% at 85% 8%, rgba(47,55,255,0.08), transparent 60%), #F2F1EC',
        },
      },
    }
    const SKIN_THEMES = {}
    for (const skin of WARROOM_SKINS) {
      const patch = SKIN_THEME_PATCHES[skin.id] || {}
      SKIN_THEMES[skin.id] = {
        dark: Object.freeze({ ...DARK_THEME, ...(patch.dark || {}) }),
        light: Object.freeze({ ...LIGHT_THEME, ...(patch.light || {}) }),
        backdrop: { dark: patch.backdrop?.dark || CLEAN_DUAL_BACKDROP.dark, light: patch.backdrop?.light || CLEAN_DUAL_BACKDROP.light },
      }
    }

    // Unified styles matching @dsh-video/shared `VIDEO_STYLES`
    const UNIFIED_STYLES = [
      { id: 'emerald', label: '墨翠轻奢', desc: '深翠墨底 · 柔金光影', swatch: '#45D1B2', gradient: 'linear-gradient(135deg, #45D1B2, #0F766E)' },
      { id: 'tech', label: '科技锋芒', desc: '几何光线 · 精密节奏', swatch: '#22D3EE', gradient: 'linear-gradient(135deg, #0EA5E9, #6366F1)' },
      { id: 'cinematic', label: '电影大片', desc: '黄金比例 · 光影叙事', swatch: '#F5B942', gradient: 'linear-gradient(135deg, #F59E0B, #B45309)' },
      { id: 'documentary', label: '极简纪实', desc: '克制留白 · 权威旁白', swatch: '#94A3B8', gradient: 'linear-gradient(135deg, #64748B, #334155)' },
      { id: 'energetic', label: '活力潮牌', desc: '快切节拍 · 高能撞色', swatch: '#FB7185', gradient: 'linear-gradient(135deg, #F43F5E, #EC4899)' },
      { id: 'warm', label: '温暖故事', desc: '柔光琥珀 · 人文温度', swatch: '#FB923C', gradient: 'linear-gradient(135deg, #FB923C, #D97706)' },
    ]

    // 视觉风格 values: 'auto' (AI 自由匹配 — the AI picks a preset for the topic or designs a new style), a preset id, or
    // 'user:<id>' (我的风格预设, saved in DSH_VIDEO_HOME/style-presets.json). script.style always stays the base preset;
    // script.styleMode / styleProfile / styleAuto say which of the three the project uses (see dsh-tool-media/style-presets.js).
    const STYLE_AUTO_COLORS = ['#7C5CFF', '#22D3EE', '#F5B942']
    const STYLE_AUTO_GRADIENT = 'linear-gradient(135deg, #7C5CFF, #22D3EE 55%, #F5B942)'
    const isPresetStyle = (v) => UNIFIED_STYLES.some((s) => s.id === v)
    const presetStyleLabel = (id) => (UNIFIED_STYLES.find((s) => s.id === id) || {}).label || String(id || '')
    // same rule as effectiveStyleMode() in style-presets.js (an older writer that changed `style` → an explicit preset)
    function scriptStyleMode(sc) {
      if (!sc || typeof sc !== 'object') return 'preset'
      if (sc.styleMode === 'auto') return sc.styleAuto && sc.styleAuto.style && sc.styleAuto.style !== sc.style ? 'preset' : 'auto'
      if (sc.styleMode === 'user') return sc.styleProfile && sc.styleProfile.base === sc.style ? 'user' : 'preset'
      return 'preset'
    }
    /** UI value of a project's style: 'auto' | presetId | 'user:<id>' */
    function scriptStyleValue(sc) {
      const mode = scriptStyleMode(sc)
      if (mode === 'auto') return 'auto'
      if (mode === 'user' && sc.styleProfile.presetId) return `user:${sc.styleProfile.presetId}`
      return isPresetStyle(sc?.style) ? sc.style : 'tech'
    }
    const paletteColors = (p) => (p && typeof p === 'object' ? [p.background, p.accent, p.gold || p.accent2].filter(Boolean) : [])
    /**
     * Style option lists: AI 自由匹配 first, then the 6 presets, then 我的风格预设. `styles` (the skins) shows the project's
     * AI decision as the selected entry (「AI：<name>」); `styleCards` (panel kit, new-project dialog) keeps the plain name.
     */
    function buildStyleOptions(sc, presets) {
      const sel = sc ? scriptStyleValue(sc) : ''
      const prof = sc && sc.styleProfile && typeof sc.styleProfile === 'object' ? sc.styleProfile : null
      // a run decided (styleAuto.by 'rules' / 'llm'; 'pending' = chosen in the UI, nothing generated yet)
      const decided = sel === 'auto' && sc.styleAuto && sc.styleAuto.by !== 'pending' && isPresetStyle(sc.styleAuto.style) ? sc.styleAuto : null
      const aiName = decided ? (decided.custom && prof ? String(prof.name || '') : presetStyleLabel(decided.style)) : ''
      const aiColors = decided ? (decided.custom && prof ? paletteColors(prof.palette) : []) : STYLE_AUTO_COLORS
      const autoHint = 'AI 按主题从这些风格里挑选，都不合适时自创新风格'
      const userList = (Array.isArray(presets) ? presets : [])
        .filter((p) => p && p.id && p.name)
        .map((p) => ({
          value: `user:${p.id}`,
          label: String(p.name),
          hint: String(p.desc || '我的风格预设'),
          swatch: p.palette?.accent || '',
          colors: paletteColors(p.palette),
          gradient: p.palette ? `linear-gradient(135deg, ${p.palette.background}, ${p.palette.accent} 60%, ${p.palette.gold || p.palette.accent2})` : '',
          kind: 'user',
        }))
      if (sel.startsWith('user:') && prof && !userList.some((o) => o.value === sel)) {
        userList.push({ value: sel, label: String(prof.name || '我的风格'), hint: '本工程保存的风格（原预设已删除）', swatch: prof.palette?.accent || '', colors: paletteColors(prof.palette), gradient: '', kind: 'user' })
      }
      const presetsList = UNIFIED_STYLES.map((s) => ({ value: s.id, label: s.label, hint: s.desc, swatch: s.swatch, gradient: s.gradient, colors: [], kind: 'preset', preset: s.id }))
      // the AI's pick: a preset (skins draw their own swatch of `preset`) or a new design (its palette in `colors`)
      const pickedPreset = decided && !(decided.custom && prof) ? UNIFIED_STYLES.find((s) => s.id === decided.style) : null
      const autoGradient = aiColors.length >= 3 && decided ? `linear-gradient(135deg, ${aiColors[0]}, ${aiColors[1]} 60%, ${aiColors[2]})` : pickedPreset ? pickedPreset.gradient : STYLE_AUTO_GRADIENT
      const styles = [
        {
          value: 'auto',
          label: aiName ? `AI：${aiName}` : 'AI 自由匹配',
          hint: aiName ? `AI 自由匹配 · 本片 AI 选择了「${aiName}」` : autoHint,
          swatch: pickedPreset ? pickedPreset.swatch : aiColors[1] || '#7C5CFF',
          colors: aiColors,
          gradient: autoGradient,
          kind: 'auto',
          preset: pickedPreset ? pickedPreset.id : '',
          ai: aiName,
        },
        ...presetsList,
        ...userList,
      ]
      const styleCards = [
        { value: 'auto', label: 'AI 自由匹配', hint: autoHint, swatch: STYLE_AUTO_GRADIENT, kind: 'auto' },
        ...presetsList.map((o) => ({ value: o.value, label: o.label, hint: o.hint, swatch: o.swatch, kind: 'preset' })),
        ...userList.map((o) => ({ value: o.value, label: o.label, hint: o.hint, swatch: o.gradient || o.swatch, colors: o.colors, kind: 'user' })),
      ]
      return { styles, styleCards }
    }

    const ASPECT_RATIO_OPTIONS = [
      { id: 'auto', label: 'AI 智能判断', sub: '依据主题自动', icon: '✦' },
      { id: '16:9', label: '16:9 横屏', sub: 'B站 / YouTube / 大屏', icon: '▭' },
      { id: '9:16', label: '9:16 竖屏', sub: '抖音 / 快手 / 视频号', icon: '▯' },
      { id: '3:4', label: '3:4 竖版 · 小红书', sub: '图文笔记 · 首图不裁切', icon: '▯' },
      { id: '1:1', label: '1:1 方屏', sub: '信息流 / 动态卡片', icon: '◻' },
      { id: '4:3', label: '4:3 复古', sub: '课件 / 访谈叙事', icon: '❐' },
      { id: 'custom', label: '自定义', sub: '手动宽高像素', icon: '⊞' },
    ]


    // 人物画风: how people and animals are drawn (same list as FIGURE_STYLE_CHOICES in dsh-tool-media/figure-kit.js)
    const FIGURE_STYLE_OPTIONS = [
      { value: 'auto', label: 'AI 按作品气质决定（推荐）', hint: '历史题材默认剪影，其它题材由 AI 自己定；需求里写明的画风照样有效' },
      { value: 'silhouette', label: '剪影', hint: '逆光黑色轮廓加金边轮廓光，适合历史、史诗、战争' },
      { value: 'papercut', label: '剪纸', hint: '红纸镂空的窗花质感，适合民俗、节日' },
      { value: 'puppet', label: '皮影', hint: '半透明彩色皮影，带关节铆钉和操纵杆，适合戏曲、传说' },
      { value: 'ink', label: '水墨', hint: '墨色晕染，适合古诗词、山水' },
      { value: 'flat', label: '扁平插画', hint: '彩色扁平侧身人物，适合生活、产品、科普' },
      { value: 'stick', label: '火柴人', hint: '线条小人，适合搞笑段子、教程、简笔故事' },
      { value: 'custom', label: '自定义（AI 自己设计角色）', hint: 'Q版、动漫、绘本、像素等人物库没有的画风，在下面写清楚想要的样子' },
    ]
    const FIGURE_STYLE_VALUES = FIGURE_STYLE_OPTIONS.map((o) => o.value)
    const cleanFigureNote = (v) => String(v ?? '').replace(/["“”'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40)

    const PLATFORM_OPTIONS = [
      { id: 'universal', label: '通用全平台', hint: '标准 5% 安全边距' },
      { id: 'douyin', label: '抖音 / 视频号', hint: '避让右侧点赞与底部字幕区' },
      { id: 'bilibili', label: 'B站 / YouTube', hint: '横屏片头与弹幕防遮挡' },
      { id: 'xiaohongshu', label: '小红书图文视频', hint: '推荐 3:4 竖版 · 底部文案与首图防裁切' },
    ]

    const MOTION_OPTIONS = [
      { value: 'zoom-in', label: '缓推拉近 (Zoom In)' },
      { value: 'zoom-out', label: '缓拉远景 (Zoom Out)' },
      { value: 'pan-left', label: '横向左移 (Pan Left)' },
      { value: 'pan-right', label: '横向右移 (Pan Right)' },
      { value: 'static', label: '锁定静止 (Static)' },
    ]

    const SCENE_LAYOUT_OPTIONS = [
      { value: '3d-stage-opener', label: '🪐 Three.js 3D 空间开场', sub: '三维透视卡片群 + 3D 几何舞台' },
      { value: 'svg-architecture-flow', label: '🕸️ 动态 SVG 架构拓扑图', sub: '5种系统拓扑 + 贝塞尔光子总线' },
      { value: 'hud-telemetry-dashboard', label: '📊 HUD 遥测数据与代码流', sub: '实时 TSX 代码流 + 环形仪表 + 波形' },
      { value: 'vibecoding-spring-stage', label: '⚡ Vibecoding 节拍弹簧舞台', sub: '双栏弹簧物理联动 + 拓扑/遥测' },
      { value: 'app-focus-shot', label: '🖥️ 软件窗口推镜特写', sub: 'AppWindow + 焦点放大镜' },
      { value: 'workflow-steps', label: '🔗 多步流程演进卡片', sub: '3~5 步横向流程拆解' },
      { value: 'metric-dashboard', label: '📈 核心数据增长看板', sub: '滚动数字 + 进度矩阵 + 架构视窗' },
      { value: 'split-wipe-compare', label: '🌓 A/B 滑动擦除对比', sub: '双画面动态分割线对比' },
      { value: 'multi-window-trio', label: '🪟 三联多视窗矩阵', sub: '三窗口并列脉冲高亮' },
      { value: 'card-fan-opener', label: '🃏 扇形图集阵列开场', sub: '多图弧形扇面展开' },
      { value: 'mosaic-pulse-wall', label: '🧱 节拍脉冲图墙', sub: '6 宫格随音乐鼓点跃动' },
      { value: 'kinetic-impact', label: '💥 高能大字冲击卡点', sub: '逐字弹簧冲击 + 粒子光环' },
      { value: 'radial-climax', label: '🎯 终幕流光印章收尾', sub: '放射速度线 + 品牌落版印章' },
      { value: 'narrative-diorama', label: '🏯 东方史诗剪影剧场', sub: '水墨剪影 + 竖排书法 (历史专用)' },
    ]

    const THREE_PRESET_OPTIONS = [
      { value: 'orbital-core', label: '🪐 星环核心 (orbital-core)' },
      { value: 'cyber-terrain', label: '🏔️ 赛博山谷网格 (cyber-terrain)' },
      { value: 'particle-vortex', label: '🌀 量子粒子星云 (particle-vortex)' },
      { value: 'floating-monoliths', label: '🗿 悬浮几何碑林 (floating-monoliths)' },
      { value: 'chrono-helix', label: '🧬 时空双螺旋 (chrono-helix)' },
      { value: 'matrix-cubes', label: '🧊 全息算力矩阵 (matrix-cubes)' },
    ]

    // =========================================================================
    // 2. HELPERS: MEDIA DETECT, ICONS, BEGINNER ERROR TRANSLATOR, THEME WATCH
    // =========================================================================
    function detectDshThemeIsDark() {
      try {
        const html = document.documentElement
        const body = document.body
        const dt = (html.getAttribute('data-theme') || body?.getAttribute('data-theme') || '').toLowerCase()
        if (dt === 'light') return false
        if (dt === 'dark') return true
        if (html.classList.contains('light') || body?.classList.contains('light')) return false
        if (html.classList.contains('dark') || body?.classList.contains('dark')) return true
        const bg = getComputedStyle(body || html).backgroundColor
        const m = bg && bg.match(/\d+/g)
        if (m && m.length >= 3) {
          const lum = (Number(m[0]) * 299 + Number(m[1]) * 587 + Number(m[2]) * 114) / 1000
          return lum < 130
        }
        return window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
      } catch {
        return true
      }
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => {
          const str = String(fr.result || '')
          const idx = str.indexOf(',')
          resolve(idx >= 0 ? str.slice(idx + 1) : str)
        }
        fr.onerror = () => reject(fr.error || new Error('读取文件失败'))
        fr.readAsDataURL(file)
      })
    }

    function translateBeginnerError(raw) {
      const msg = String(raw || '').trim()
      if (!msg) return { title: '操作遇到问题', detail: '' }
      const low = msg.toLowerCase()
      if (low.includes('402') || low.includes('insufficient_quota') || low.includes('insufficient balance') || low.includes('余额不足') || low.includes('欠费') || low.includes('账户余额') || low.includes('billing')) {
        return {
          title: '账户余额不足或欠费 — 已自动停止，不会自动重试以免重复扣费；请先到对应平台充值，再点「↻ 重新执行」',
          detail: msg,
          action: 'open-llm',
        }
      }
      if (low.includes('401') || low.includes('403') || low.includes('unauthorized') || low.includes('api key') || low.includes('未配置') || low.includes('invalid x-api-key')) {
        return {
          title: '模型密钥 (API Key) 未设置或无效 — 请点右上角「AI 模型」核对密钥，或切换为「本地草稿预演」零配置先出片',
          detail: msg,
          action: 'open-llm',
        }
      }
      if (low.includes('429') || low.includes('quota') || low.includes('rate limit') || low.includes('余额')) {
        return {
          title: '模型接口请求过于频繁或额度不足 — 请更换模型、稍后重试，或点选「本地草稿预演」继续创作',
          detail: msg,
          action: 'open-llm',
        }
      }
      if (low.includes('enotfound') || low.includes('econnrefused') || low.includes('fetch failed') || low.includes('networkerror') || low.includes('timed out')) {
        return {
          title: '网络连接大模型或本地服务超时 — 请检查网络代理设置或 API Base URL 地址是否正确',
          detail: msg,
          action: 'open-llm',
        }
      }
      if (low.includes('no assets') || low.includes('暂无可用素材')) {
        return {
          title: '当前工程还没有画面素材 — 点一下「🎁 加载新手演示素材」即可立刻试拍成片',
          detail: msg,
          action: 'load-starter',
        }
      }
      return { title: msg, detail: '' }
    }


    function Icon({ name, size = 16, color = 'currentColor' }) {
      const common = {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        style: { flexShrink: 0, display: 'inline-block' },
      }
      const p = (...ds) => ds.map((d, i) => h('path', { key: i, d }))
      switch (name) {
        case 'film':
          return h('svg', common, h('rect', { x: 2, y: 3, width: 20, height: 18, rx: 3 }), ...p('M7 3v18', 'M17 3v18', 'M2 12h20', 'M2 7.5h5', 'M2 16.5h5', 'M17 7.5h5', 'M17 16.5h5'))
        case 'sparkles':
          return h('svg', common, ...p('M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z', 'M5 17l.9 2.1L8 20l-2.1.9L5 23l-.9-2.1L2 20l2.1-.9z', 'M19 3l.8 1.8L21.5 5.6l-1.7.7L19 8l-.7-1.7-1.8-.7 1.8-.8z'))
        case 'play':
          return h('svg', { ...common, fill: color }, h('polygon', { points: '6 4 20 12 6 20 6 4' }))
        case 'pause':
          return h('svg', { ...common, fill: color }, h('rect', { x: 6, y: 4, width: 4, height: 16 }), h('rect', { x: 14, y: 4, width: 4, height: 16 }))
        case 'upload':
          return h('svg', common, ...p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M17 8l-5-5-5 5', 'M12 3v12'))
        case 'folder':
          return h('svg', common, ...p('M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'))
        case 'mic':
          return h('svg', common, ...p('M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z', 'M19 10v2a7 7 0 0 1-14 0v-2', 'M12 19v4', 'M8 23h8'))
        case 'cpu':
          return h('svg', common, h('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }), h('rect', { x: 9, y: 9, width: 6, height: 6 }), ...p('M9 1v3', 'M15 1v3', 'M9 20v3', 'M15 20v3', 'M20 9h3', 'M20 14h3', 'M1 9h3', 'M1 14h3'))
        case 'sun':
          return h('svg', common, h('circle', { cx: 12, cy: 12, r: 4 }), ...p('M12 2v2', 'M12 20v2', 'M4.93 4.93l1.41 1.41', 'M17.66 17.66l1.41 1.41', 'M2 12h2', 'M20 12h2', 'M6.34 17.66l-1.41 1.41', 'M19.07 4.93l-1.41 1.41'))
        case 'moon':
          return h('svg', common, ...p('M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z'))
        case 'plus':
          return h('svg', common, ...p('M12 5v14', 'M5 12h14'))
        case 'trash':
          return h('svg', common, ...p('M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'))
        case 'download':
          return h('svg', common, ...p('M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'))
        case 'check':
          return h('svg', common, ...p('M20 6L9 17l-5-5'))
        case 'x':
          return h('svg', common, ...p('M18 6L6 18', 'M6 6l12 12'))
        case 'undo':
          return h('svg', common, ...p('M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'))
        case 'code':
          return h('svg', common, ...p('M16 18l6-6-6-6', 'M8 6l-6 6 6 6'))
        case 'zap':
          return h('svg', common, ...p('M13 2L3 14h9l-1 8 10-12h-9l1-8z'))
        case 'camera':
          return h('svg', common, ...p('M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'), h('circle', { cx: 12, cy: 13, r: 4 }))
        case 'palette':
          return h('svg', common, ...p('M12 22a1 1 0 0 1-1-1v-2a1 1 0 0 0-1-1H7a5 5 0 0 1 0-10h1a6 6 0 0 0 6-6 9 9 0 0 1 9 9 9 9 0 0 1-9 9z'))
        case 'scissors':
          return h('svg', common, h('circle', { cx: 6, cy: 6, r: 3 }), h('circle', { cx: 6, cy: 18, r: 3 }), ...p('M20 4L8.12 15.88', 'M14.47 14.48L20 20', 'M8.12 8.12L12 12'))
        case 'chevron-down':
          return h('svg', common, ...p('M6 9l6 6 6-6'))
        case 'sliders':
          return h('svg', common, ...p('M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'))
        case 'gift':
          return h('svg', common, h('rect', { x: 3, y: 8, width: 18, height: 4 }), h('rect', { x: 4, y: 12, width: 16, height: 9, rx: 1 }), ...p('M12 8v13', 'M12 8H8a2.5 2.5 0 1 1 2.5-2.5V8', 'M12 8h4a2.5 2.5 0 1 0-2.5-2.5V8'))
        case 'eye':
          return h('svg', common, ...p('M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z'), h('circle', { cx: 12, cy: 12, r: 3 }))
        case 'bot':
          return h('svg', common, h('rect', { x: 3, y: 7, width: 18, height: 13, rx: 3 }), ...p('M12 7V3', 'M8 3h8', 'M9 13v2', 'M15 13v2'))
        default:
          return h('svg', common, h('circle', { cx: 12, cy: 12, r: 8 }))
      }
    }

    function SidebarVideoIcon(props) {
      const sz = Number(props?.size) || 20
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: sz, height: sz, fill: 'none', stroke: 'currentColor', strokeWidth: 1.85, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 2.5, y: 3.5, width: 19, height: 17, rx: 3 }),
        h('line', { x1: 7.5, y1: 3.5, x2: 7.5, y2: 20.5 }),
        h('line', { x1: 16.5, y1: 3.5, x2: 16.5, y2: 20.5 }),
        h('polygon', { points: '10.5 9 14.5 12 10.5 15', fill: 'currentColor', stroke: 'none' }),
      )
    }

    const ReactComponentBase = React && typeof React.Component === 'function' ? React.Component : class { constructor(props) { this.props = props || {} } }

    class PanelBoundary extends ReactComponentBase {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }
      static getDerivedStateFromError(error) {
        return { error }
      }
      render() {
        if (this.state.error) {
          return h(
            'div',
            { style: { padding: '32px', color: '#FB7185', background: '#07090F', minHeight: '220px', fontFamily: 'Microsoft YaHei, sans-serif' } },
            h('h3', { style: { margin: '0 0 10px', fontSize: '18px' } }, '电影视频工坊面板渲染异常'),
            h('pre', { style: { fontSize: '13px', whiteSpace: 'pre-wrap', opacity: 0.9 } }, String(this.state.error?.message || this.state.error)),
            h(
              'button',
              {
                onClick: () => this.setState({ error: null }),
                style: { marginTop: '14px', padding: '10px 18px', borderRadius: '10px', border: 'none', background: '#22D3EE', color: '#051018', fontWeight: 700, cursor: 'pointer', fontSize: '14px' },
              },
              '重新加载界面',
            ),
          )
        }
        return this.props.children
      }
    }

    // =========================================================================
    // 3. CUSTOM UI PRIMITIVES (ZERO NATIVE <select> — CINEMA GLASS POPOVER)
    // =========================================================================


    // =========================================================================
    // 4. KINETIC 3D PERSPECTIVE CANVAS & REAL-TIME DSP WAVEFORM
    // =========================================================================


    // =========================================================================
    // 5. MAIN APPLICATION
    // =========================================================================
    let hostLayoutSvc = null
    const hostLayoutListeners = new Set()
    const notifyHostLayout = () => {
      for (const cb of hostLayoutListeners) {
        try {
          cb()
        } catch {}
      }
    }
    const attachHostLayout = (layout) => {
      if (!layout || hostLayoutSvc === layout) return
      hostLayoutSvc = layout
      notifyHostLayout()
      try {
        layout.panelInfo?.subscribe?.(notifyHostLayout)
      } catch {}
    }

    const DEFAULT_TTS_ENGINES_FALLBACK = [
      {
        id: 'indextts25',
        builtin: true,
        kind: 'indextts25',
        name: 'IndexTTS-2.5 (高保真情感克隆)',
        shortName: 'IndexTTS-2.5',
        vramBadge: '推荐 8GB+ 显存',
        description: '支持零样本音色克隆、情感语音参考及 Qwen 情绪指令控制，音质细腻。',
        endpoint: 'http://127.0.0.1:9880',
      },
      {
        id: 'indextts2',
        builtin: true,
        kind: 'indextts2',
        name: 'IndexTTS-2 (经典本地版本)',
        shortName: 'IndexTTS-2',
        vramBadge: '6–8GB 显存',
        description: '兼容旧版 cy_app / IndexTTS-2 HTTP 与本地推理入口。',
        endpoint: 'http://127.0.0.1:9880',
      },
      {
        id: 'gptvoice',
        builtin: true,
        kind: 'gptvoice',
        name: 'GPT-SoVITS (低显存轻量克隆)',
        shortName: 'GPT-SoVITS',
        vramBadge: '4GB+ 显存 · 低配友好',
        description: '专为低显存 / 中低配显卡优化的轻量配音与音色克隆方案，兼容 api_v2.py 与 v1 接口。',
        endpoint: 'http://127.0.0.1:9881',
      },
      {
        id: 'minimax-tts',
        builtin: true,
        kind: 'minimax-tts',
        name: 'MiniMax Speech 云端情感语音 (T2A v2)',
        shortName: 'MiniMax 云端语音',
        vramBadge: '0GB 显存 · 云端高表现力',
        description: '支持 speech-2.6-hd / speech-02-hd 及任意自定义模型 ID，无需本地显卡即可合成多情绪中文配音。',
        endpoint: 'https://api.minimaxi.com/v1/t2a_v2',
        model: 'speech-2.6-hd',
        voiceId: 'male-qn-qingse',
      },
      {
        id: 'doubao-tts',
        builtin: true,
        kind: 'doubao-tts',
        name: '火山方舟 · 豆包语音大模型 TTS',
        shortName: '豆包云端语音',
        vramBadge: '0GB 显存 · 火山引擎云端',
        description: '直连火山引擎 / 豆包语音合成 HTTP 接口，支持 AppID + Token + 自定义音色 voice_type。',
        endpoint: 'https://openspeech.bytedance.com/api/v1/tts',
        cluster: 'volcano_tts',
        voiceType: 'zh_male_m392_conversation_wvae_bigtts',
      },
    ]

    const DEFAULT_TTS_TEMPLATES_FALLBACK = [
      {
        templateId: 'edge-tts-cpu',
        label: 'Edge-TTS (零显卡纯 CPU 命令行)',
        engine: {
          id: 'edge-tts-cpu',
          name: 'Edge-TTS 轻量旁白 (纯CPU零显存)',
          kind: 'cli-command',
          vramBadge: '0GB 显存 · 纯CPU',
          command: 'edge-tts',
          argsTemplate: '--text {{text}} --voice {{voice}} --write-media {{output}}',
          defaultVoice: 'zh-CN-YunxiNeural',
          outputExt: '.mp3',
        },
      },
      {
        templateId: 'fish-speech-openai',
        label: 'Fish Speech / OpenAI /v1/audio/speech',
        engine: {
          id: 'fish-speech-openai',
          name: 'Fish Speech / OpenAI TTS 接口',
          kind: 'openai-tts',
          vramBadge: '云端或本机 API',
          endpoint: 'http://127.0.0.1:8080/v1/audio/speech',
          model: 'fish-speech-1.5',
          voice: 'default',
          responseFormat: 'wav',
          speed: 1.0,
        },
      },
      {
        templateId: 'kokoro-openai',
        label: 'Kokoro-FastAPI (超轻量本地 / CPU)',
        engine: {
          id: 'kokoro-openai',
          name: 'Kokoro 82M 超轻量语音',
          kind: 'openai-tts',
          vramBadge: 'CPU / <2GB 显存',
          endpoint: 'http://127.0.0.1:8880/v1/audio/speech',
          model: 'kokoro',
          voice: 'zf_xiaoxiao',
          responseFormat: 'wav',
          speed: 1.0,
        },
      },
      {
        templateId: 'cosyvoice-http',
        label: 'CosyVoice / ChatTTS 通用 HTTP JSON',
        engine: {
          id: 'cosyvoice-http',
          name: 'CosyVoice / 自定义 HTTP 模型',
          kind: 'http-json',
          vramBadge: '自定义 HTTP',
          endpoint: 'http://127.0.0.1:9882/tts',
          method: 'POST',
          responseType: 'binary',
          responseAudioPath: 'audio',
          payloadTemplate: { text: '{{text}}', voice: '{{voiceName}}', lang: '{{lang}}', speed: '{{speed}}', ref_audio: '{{refAudio}}', prompt_text: '{{promptText}}' },
        },
      },
    ]

    function VideoWorkbenchApp({ ctx, isMainSlot = false, layoutService = null }) {
      const [, setHostLayoutRev] = useState(0)
      useEffect(() => {
        const listener = () => setHostLayoutRev((r) => r + 1)
        hostLayoutListeners.add(listener)
        return () => hostLayoutListeners.delete(listener)
      }, [])
      const getHostLayout = () => {
        if (layoutService) return layoutService
        if (hostLayoutSvc) return hostLayoutSvc
        try {
          if (typeof ctx?.get === 'function') return ctx.get('layout') || null
        } catch {}
        try {
          return ctx?.layout || null
        } catch {}
        return null
      }
      const connFetch = useMemo(() => {
        try {
          const conn = typeof ctx?.get === 'function' ? ctx.get('connection') : ctx?.connection
          if (typeof conn?.fetch === 'function') return conn.fetch.bind(conn)
        } catch {}
        return (url, init = {}) => window.fetch(url, { credentials: 'same-origin', ...init })
      }, [ctx])

      // Host Mode & Clean Dual Theme (Light / Dark)
      const [mode, setMode] = useState('video')
      const [mainSlotActive, setMainSlotActive] = useState(false)
      const [themePref, setThemePref] = useState(() => {
        try {
          const saved = localStorage.getItem('dsh-vw-theme-pref')
          if (saved === 'dark' || saved === 'light') return saved
        } catch {}
        return detectDshThemeIsDark() ? 'dark' : 'light'
      })
      const resolvedDark = themePref === 'dark'
      // Switchable AI war-room skin (A/B/C iframe skins; 棱镜实验室 by default); also tints the remaining host chrome
      const [warSkin, setWarSkin] = useState(readStoredWarSkin)
      const skinThemeSet = SKIN_THEMES[warSkin] || null
      const T = skinThemeSet ? (resolvedDark ? skinThemeSet.dark : skinThemeSet.light) : resolvedDark ? DARK_THEME : LIGHT_THEME


      // Responsive viewport width tracking for zero-overflow Topbar
      const [viewportWidth, setViewportWidth] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 1440))
      const [showTopMoreMenu, setShowTopMoreMenu] = useState(false)
      useEffect(() => {
        const onResize = () => setViewportWidth(window.innerWidth || 1440)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])

      // Navigation: Streamlined 3 Top Modes (`warroom` | `studio` | `tasks`) + Studio Step `1..4`
      const [activeNav, setActiveNav] = useState('warroom')
      // War-room skin bridge state: 'loading' until the skin posts dsh-vw/ready, 'failed' → recovery screen (retry / other skin)
      const [warSkinPhase, setWarSkinPhase] = useState('loading')
      const [warSkinCatalog, setWarSkinCatalog] = useState(null) // null = pending · false = unknown (assume installed) · { [skinId]: available }
      const [warSkinReloadKey, setWarSkinReloadKey] = useState(0)
      // Bumped after every completed /state load — lets the in-skin panels know their cached data is stale
      const [stateRev, setStateRev] = useState(0)
      const [showSkinMenu, setShowSkinMenu] = useState(false)
      // 工程安全与高级工具 (OpenFilm B) + 专业交付 (OpenFilm A)
      const [showProToolsModal, setShowProToolsModal] = useState(false)
      const [proToolsTab, setProToolsTab] = useState('history') // history | locks | characters | stock | cloudjobs | lipsync
      const [proHistory, setProHistory] = useState(null)
      const [proHistoryDiff, setProHistoryDiff] = useState(null)
      const [proSceneEdits, setProSceneEdits] = useState(null)
      const [proCharacters, setProCharacters] = useState(null)
      const [proCharForm, setProCharForm] = useState({ name: '', aliases: '', description: '' })
      const [proStockQuery, setProStockQuery] = useState('')
      const [proStockType, setProStockType] = useState('image')
      const [proStockResult, setProStockResult] = useState(null)
      const [proCloudJobs, setProCloudJobs] = useState(null)
      const [proBusy, setProBusy] = useState('')
      const [deliveryFormats, setDeliveryFormats] = useState(['srt', 'vtt', 'stems', 'fcpxml', 'xmeml'])
      const [deliveryLut, setDeliveryLut] = useState('')
      const [deliveryLuts, setDeliveryLuts] = useState([])
      const [deliveryResult, setDeliveryResult] = useState(null)
      const [scopesResult, setScopesResult] = useState(null)
      const [scopesTimeSec, setScopesTimeSec] = useState(0)
      const [deepQaResult, setDeepQaResult] = useState(null)
      const [refineRangeOn, setRefineRangeOn] = useState(false)
      const [refineRange, setRefineRange] = useState({ startSec: 0, endSec: 3 })
      const [refinePreview, setRefinePreview] = useState(null)
      const skinMenuRef = useRef(null)
      const [lipsyncStatus, setLipsyncStatus] = useState(null)
      const warSkinFrameRef = useRef(null)
      const warSkinRef = useRef(warSkin)
      warSkinRef.current = warSkin
      const warSkinPhaseRef = useRef(warSkinPhase)
      warSkinPhaseRef.current = warSkinPhase
      const changeWarSkin = useCallback((next, { syncTone = true } = {}) => {
        const id = WARROOM_SKINS.some((s) => s.id === next) ? next : WARROOM_DEFAULT_SKIN
        setShowSkinMenu(false)
        if (warSkinRef.current !== id) {
          warSkinRef.current = id
          setWarSkin(id)
          setWarSkinPhase('loading')
        } else if (warSkinPhaseRef.current === 'failed') {
          setWarSkinPhase('loading')
          setWarSkinReloadKey((k) => k + 1)
        }
        try {
          localStorage.setItem(WARROOM_SKIN_STORAGE_KEY, id)
        } catch {}
        const meta = WARROOM_SKINS.find((s) => s.id === id)
        if (syncTone && meta?.tone) {
          setThemePref(meta.tone)
          try {
            localStorage.setItem('dsh-vw-theme-pref', meta.tone)
          } catch {}
        }
      }, [])
      const [studioStep, setStudioStep] = useState(1)
      const [warCenterTab, setWarCenterTab] = useState('theater') // 'theater' | 'mp4' | 'preview'
      const [showProjectDrawer, setShowProjectDrawer] = useState(false)
      const [showAdvancedDirector, setShowAdvancedDirector] = useState(false)


      // Project & Backend Workspace State
      const [projects, setProjects] = useState([])
      const [activeProjectDir, setActiveProjectDir] = useState('')
      const [script, setScript] = useState(null)
      const [projectAssets, setProjectAssets] = useState([])
      const [assetSummary, setAssetSummary] = useState({ image: 0, video: 0, music: 0, sfx: 0, notes: 0, hostVideo: 0, avatarBase: 0, voiceClone: 0 })
      const [hasMp4, setHasMp4] = useState(false)
      const [hasSnapshot, setHasSnapshot] = useState(false)
      const [hasMasterAudio, setHasMasterAudio] = useState(false)
      const [sceneThumbs, setSceneThumbs] = useState({})
      const [step3MonitorSource, setStep3MonitorSource] = useState('html-draft') // 'final-video' | 'html-draft'
      const [qaReport, setQaReport] = useState(null)
      const [buildLog, setBuildLog] = useState(null)
      const [historyCount, setHistoryCount] = useState(0)
      const [voiceCatalog, setVoiceCatalog] = useState([])
      const [availableEmotions, setAvailableEmotions] = useState(['平静', '高兴', '激昂', '温和', '自信', '严肃', '期待', '深沉', '伤心'])
      const [hardwareProfile, setHardwareProfile] = useState(null)
      const [hardwarePreferences, setHardwarePreferences] = useState({ lowSpecMode: 'auto' })
      const [hardwarePolicy, setHardwarePolicy] = useState(null)
      const [vibeToolkit, setVibeToolkit] = useState([])
      const [showHardwareModal, setShowHardwareModal] = useState(false)
      const [hardwareRefreshing, setHardwareRefreshing] = useState(false)
      const [ttsStatus, setTtsStatus] = useState({ reachable: false, ready: false, engine: 'indextts25', engineName: 'IndexTTS-2.5' })
      const [ttsConfig, setTtsConfig] = useState({
        activeEngineId: 'indextts25',
        engines: DEFAULT_TTS_ENGINES_FALLBACK,
        templates: DEFAULT_TTS_TEMPLATES_FALLBACK,
      })
      const [ttsBackendOutdated, setTtsBackendOutdated] = useState(false)
      // Unified AI Engine & Models Hub (LLM + Local/Cloud TTS + Cloud Media)
      const [showAiHubModal, setShowAiHubModal] = useState(false)
      const [aiHubTab, setAiHubTab] = useState('llm') // 'llm' | 'tts' | 'cloud'
      const showTtsModal = showAiHubModal && aiHubTab === 'tts'
      const openAiHub = useCallback((tab = 'llm') => {
        setAiHubTab(tab)
        setShowAiHubModal(true)
        setShowTopMoreMenu(false)
      }, [])
      const setShowLlmModal = useCallback((v) => {
        if (v) openAiHub('llm')
        else setShowAiHubModal(false)
      }, [openAiHub])
      const setShowTtsModal = useCallback((v) => {
        if (v) openAiHub('tts')
        else setShowAiHubModal(false)
      }, [openAiHub])
      const setShowCloudMediaModal = useCallback((v) => {
        if (v) openAiHub('cloud')
        else setShowAiHubModal(false)
      }, [openAiHub])
      const [ttsModalTab, setTtsModalTab] = useState('engines') // 'engines' | 'install' | 'add' | 'import'
      const [builtinTtsForm, setBuiltinTtsForm] = useState({
        indextts25Endpoint: 'http://127.0.0.1:9880',
        indexttsRootDir: '',
        indexttsPythonBin: '',
        gptvoiceEndpoint: 'http://127.0.0.1:9881',
        gptvoiceRootDir: '',
        gptvoicePythonBin: '',
        gptvoiceTextLang: 'zh',
        gptvoicePromptLang: 'zh',
        minimaxTtsEndpoint: 'https://api.minimaxi.com/v1/t2a_v2',
        minimaxTtsModel: 'speech-2.6-hd',
        minimaxTtsVoiceId: 'male-qn-qingse',
        minimaxTtsApiKey: '',
        minimaxTtsHasApiKey: false,
        minimaxTtsApiKeyMasked: '',
        doubaoTtsEndpoint: 'https://openspeech.bytedance.com/api/v1/tts',
        doubaoTtsAppId: '',
        doubaoTtsToken: '',
        doubaoTtsHasToken: false,
        doubaoTtsTokenMasked: '',
        doubaoTtsCluster: 'volcano_tts',
        doubaoTtsVoiceType: 'zh_male_m392_conversation_wvae_bigtts',
      })
      const [customTtsForm, setCustomTtsForm] = useState({
        id: '',
        name: '',
        kind: 'openai-tts',
        vramBadge: '自定义模型 / 低配友好',
        endpoint: 'http://127.0.0.1:8080/v1/audio/speech',
        method: 'POST',
        apiKey: '',
        model: 'fish-speech-1.5',
        voice: 'default',
        responseFormat: 'wav',
        speed: 1.0,
        responseType: 'binary',
        responseAudioPath: 'audio',
        payloadTemplateText: '{\n  "text": "{{text}}",\n  "voice": "{{voiceName}}",\n  "lang": "{{lang}}",\n  "speed": "{{speed}}"\n}',
        command: 'edge-tts',
        argsTemplate: '--text {{text}} --voice {{voice}} --write-media {{output}}',
        outputExt: '.mp3',
      })
      const [ttsImportJsonText, setTtsImportJsonText] = useState('')
      const [ttsTesting, setTtsTesting] = useState(false)
      const [ttsTestResult, setTtsTestResult] = useState(null)

      // v0.5.0: 影核广场 · CinePulse Hub + BYOK Cloud Media + Reference vs Remake Compare + Multi-Track Timeline
      const [showPlazaModal, setShowPlazaModal] = useState(false)
      const [plazaBrand, setPlazaBrand] = useState({ displayName: '影核广场 · CinePulse Hub', zhName: '影核广场', enName: 'CinePulse Hub', tagline: '双引擎动效 · 全品类节拍卡点 · 开放 MOTION.md 蓝图模板社区' })
      const [plazaCategories, setPlazaCategories] = useState([])
      const [plazaTemplates, setPlazaTemplates] = useState([])
      const [plazaCategory, setPlazaCategory] = useState('all')
      const [plazaQuery, setPlazaQuery] = useState('')
      const [plazaPreview, setPlazaPreview] = useState(null) // { template, motionMd }
      const [plazaPlayer, setPlazaPlayer] = useState(null) // template whose sample clip is open in the player
      const [plazaPlayerState, setPlazaPlayerState] = useState({ error: '', needsTap: false })
      const plazaVideoRef = useRef(null)
      const [plazaPublishName, setPlazaPublishName] = useState('')
      const [plazaPublishDesc, setPlazaPublishDesc] = useState('')
      const [plazaBusy, setPlazaBusy] = useState(false)

      const [cloudMediaTab, setCloudMediaTab] = useState('audio') // 'image' | 'video' | 'audio'
      const [cloudMediaCfg, setCloudMediaCfg] = useState(null)
      const [stagedCloudAssets, setStagedCloudAssets] = useState([])
      const [cloudGenPrompt, setCloudGenPrompt] = useState('')
      const [cloudGenLyrics, setCloudGenLyrics] = useState('')
      const [cloudGenInstrumental, setCloudGenInstrumental] = useState(false)
      const [cloudGenDuration, setCloudGenDuration] = useState(5)
      const [cloudGenSceneId, setCloudGenSceneId] = useState('')
      const [cloudGenBusy, setCloudGenBusy] = useState(false)
      const [cloudAssistBusy, setCloudAssistBusy] = useState('') // '' | 'prompt' | 'lyrics' | 'both'
      const [stagingActionBusy, setStagingActionBusy] = useState('')
      const [previewLightboxItem, setPreviewLightboxItem] = useState(null)

      const [hasReferenceVideo, setHasReferenceVideo] = useState(false)
      const [showCompareModal, setShowCompareModal] = useState(false)
      const [compareMode, setCompareMode] = useState('split') // 'split' | 'curtain'
      const [compareCurtainPct, setCompareCurtainPct] = useState(50)
      const [compareAudioSrc, setCompareAudioSrc] = useState('remake') // 'remake' | 'ref' | 'mute'
      const [comparePlaying, setComparePlaying] = useState(false)
      const [compareTime, setCompareTime] = useState(0)
      const [compareDur, setCompareDur] = useState(60)
      const [compareSpeed, setCompareSpeed] = useState(1)
      const compareRefVideoRef = useRef(null)
      const compareRemakeVideoRef = useRef(null)

      const [timelineZoom, setTimelineZoom] = useState(1)
      const [timelineSnapBeat, setTimelineSnapBeat] = useState(true)
      const [timelineSfxType, setTimelineSfxType] = useState('slash')

      // Director & Production Configuration
      const [directorForm, setDirectorForm] = useState({
        topic: '',
        displayTitle: '',
        genre: '',
        genreLabel: '',
        directorNotes: '',
        contentOutline: [],
        style: 'auto',
        engine: 'remotion',
        creationMode: 'ai-coded',
        bgmMode: 'llm-coded',
        narrationMode: 'tts',
        pacingMode: 'auto',
        durationMode: 'auto',
        targetDurationSec: 120,
        bgmTtsPrompt: '科技光影律动 温暖氛围铺底',
        targetPlatform: 'universal',
        aspectRatio: 'auto',
        quality: '1080p',
        customWidth: 1080,
        customHeight: 1920,
        aiBadge: true,
        aiBadgeEnabled: true,
        aiBadgePosition: 'top-right',
        aiBadgeText: '',
        visual3dMode: 'auto',
        visualReview: true,
        figureStyleChoice: 'auto',
        figureStyleChoiceNote: '',
        useDraftReference: true,
        fps: 30,
        voiceId: 'auto',
      })
      const [polishingTopic, setPolishingTopic] = useState(false)
      const [unpolishedTopicBackup, setUnpolishedTopicBackup] = useState('')
      const [showAvatarEndpointCfg, setShowAvatarEndpointCfg] = useState(false)
      const [avatarEndpointForm, setAvatarEndpointForm] = useState({ provider: 'auto', endpoint: '', apiKey: '' })

      // Step 1: Uploads, Drag State & Teleprompter Camera
      const [isDraggingUpload, setIsDraggingUpload] = useState(false)
      const [uploadProgressState, setUploadProgressState] = useState(null) // { current, total, fileName, percent }
      const [assetDirInput, setAssetDirInput] = useState('')
      const [assetFilter, setAssetFilter] = useState('all')
      const [showTeleprompter, setShowTeleprompter] = useState(false)
      const [teleLinesText, setTeleLinesText] = useState(
        '欢迎来到 DSH 电影视频工坊。\n只要在这里导入素材或现场录制一段口播，\n四位 AI 智能体就会协同完成分镜、剪辑、配音混音与 1080P 成片渲染。',
      )
      const [teleScrollSpeed, setTeleScrollSpeed] = useState(1.1)
      const [teleFontSize, setTeleFontSize] = useState(26)
      const [teleLineHeight, setTeleLineHeight] = useState(1.65)
      const [teleBgOpacity, setTeleBgOpacity] = useState(0.62)
      const [camSelfieMirror, setCamSelfieMirror] = useState(true)
      const [teleMirror, setTeleMirror] = useState(false)
      const [teleAutoScroll, setTeleAutoScroll] = useState(false)
      const [teleCountdown, setTeleCountdown] = useState(0) // 3 -> 2 -> 1 -> 0
      const [camStreaming, setCamStreaming] = useState(false)
      const [camRecording, setCamRecording] = useState(false)
      const [camSeconds, setCamSeconds] = useState(0)
      const [camError, setCamError] = useState('')
      const [camMicLevel, setCamMicLevel] = useState(0)
      const [camTargetRole, setCamTargetRole] = useState('host_video')
      const [camExtractClone, setCamExtractClone] = useState(true)
      const [pendingRecPreview, setPendingRecPreview] = useState(null) // { blob, url, fileName, durationEst }

      // Step 2: Avatar & Advanced Options
      const [avatarTemplates, setAvatarTemplates] = useState([])
      const [stylePresets, setStylePresets] = useState([]) // 我的风格预设 (GET state → stylePresets)
      const [avatarProvider, setAvatarProvider] = useState({ provider: 'auto', endpoint: '' })
      const [avatarVisualNotice, setAvatarVisualNotice] = useState('')
      const [avatarCfg, setAvatarCfg] = useState({
        enabled: false,
        mode: 'ai-human',
        layout: 'pip-br',
        presetId: 'cyber-anchor',
        sourcePath: '',
        voiceSamplePath: '',
        chromaKeyColor: '',
      })
      const [speechTempo, setSpeechTempo] = useState(1.0)
      const [useHostVocal, setUseHostVocal] = useState(false)
      const [aiAuthorCode, setAiAuthorCode] = useState(true)
      const [trimClipSec, setTrimClipSec] = useState(0)
      const [clipSpeedMult, setClipSpeedMult] = useState(1.0)
      const [bgmComposePreviewUrl, setBgmComposePreviewUrl] = useState('')

      // Step 3: Monitor, Safe Zone, Script Edits & AI Refine
      const [selectedSceneIdx, setSelectedSceneIdx] = useState(0)
      const [currentFrame, setCurrentFrame] = useState(0)
      const [isPlaying, setIsPlaying] = useState(false)
      const [showSafeGuides, setShowSafeGuides] = useState(false)
      const [safeZonePreflight, setSafeZonePreflight] = useState(null)
      const [refinePrompt, setRefinePrompt] = useState('')
      const [refineScope, setRefineScope] = useState('scene')
      const [scriptDirty, setScriptDirty] = useState(false)

      // Step 4: Publish Pack & QA
      const [publishPackResult, setPublishPackResult] = useState(null)
      const [showMatrixPreview, setShowMatrixPreview] = useState(false)

      // Task Center / Agent Pipeline Runs
      const [taskRuns, setTaskRuns] = useState([])
      const [selectedRunId, setSelectedRunId] = useState('')
      const [taskFilter, setTaskFilter] = useState('all')

      // Modals & Drawers
      const [showNewModal, setShowNewModal] = useState(false)
      const [newProjectTitle, setNewProjectTitle] = useState('')
      const [confirmDeleteDir, setConfirmDeleteDir] = useState('')

      const [llmConfig, setLlmConfig] = useState(null)
      const [llmForm, setLlmForm] = useState({
        mode: 'follow-dsh',
        dshProviderId: 'active',
        provider: 'custom',
        format: 'auto',
        baseUrl: '',
        apiKey: '',
        model: '',
        maxRepairRounds: 3,
      })
      const [llmTesting, setLlmTesting] = useState(false)
      const [llmTestResult, setLlmTestResult] = useState(null)

      const [showVoiceModal, setShowVoiceModal] = useState(false)
      const [voiceModalTab, setVoiceModalTab] = useState('library') // 'library' | 'clone'
      const [voiceModalTarget, setVoiceModalTarget] = useState('global')
      const [voiceSearch, setVoiceSearch] = useState('')
      const [voiceGenderFilter, setVoiceGenderFilter] = useState('all')
      const [playingVoiceId, setPlayingVoiceId] = useState('')
      const [voiceImportPath, setVoiceImportPath] = useState('')
      const [voiceImportName, setVoiceImportName] = useState('')
      const [voiceImportGender, setVoiceImportGender] = useState('female')
      const [cloneSubMode, setCloneSubMode] = useState('mic') // 'mic' | 'file' | 'path'
      const [micRecording, setMicRecording] = useState(false)
      const [micSeconds, setMicSeconds] = useState(0)
      const [micVuLevel, setMicVuLevel] = useState(0)
      const [recordedB64, setRecordedB64] = useState('')
      const [recordedFileName, setRecordedFileName] = useState('')
      const [cloneVoiceName, setCloneVoiceName] = useState('')
      const [cloneVoiceGender, setCloneVoiceGender] = useState('female')
      const [cloneVoicePrompt, setCloneVoicePrompt] = useState('')
      const [cloneAuditionVoiceId, setCloneAuditionVoiceId] = useState('')
      const [cloneAuditionText, setCloneAuditionText] = useState('你好，这是我刚克隆完成的专属声线，用大模型驱动的动画配音听起来自然流畅吗？')
      const [cloneAuditionUrl, setCloneAuditionUrl] = useState('')

      const [showVendorModal, setShowVendorModal] = useState(false)
      const [vendorSourceDir, setVendorSourceDir] = useState('')
      const [vendorName, setVendorName] = useState('')
      const [vendorDurationSec, setVendorDurationSec] = useState(6)

      const [showCodeDrawer, setShowCodeDrawer] = useState(false)
      const [codeFiles, setCodeFiles] = useState([])
      const [selectedCodePath, setSelectedCodePath] = useState('')

      // Busy & Toast Notifications
      const [busyLabel, setBusyLabel] = useState('')
      const [busyProgress, setBusyProgress] = useState(0)
      const [toast, setToast] = useState(null)
      const [showRawError, setShowRawError] = useState(false)
      const [assetVersion, setAssetVersion] = useState(1)
      const [ttsInstallCatalog, setTtsInstallCatalog] = useState(null)
      const [ttsInstallDir, setTtsInstallDir] = useState('')
      const [ttsInstallMirror, setTtsInstallMirror] = useState('cn')
      const [ttsInstallingId, setTtsInstallingId] = useState('')
      const [ttsInstallLogs, setTtsInstallLogs] = useState([])
      const [refAnalyzing, setRefAnalyzing] = useState(false)
      const [refExtractAudio, setRefExtractAudio] = useState(false)

      // DOM & Stream Refs
      const initialLoadedRef = useRef(false)
      const prevProjectDirRef = useRef('')
      // Last script.json as the server saw it (baseline for recording the user's hand edits as overrides)
      const serverScriptRef = useRef(null)
      // Brief the current storyboard was made from; a run with a different brief drops old per-scene overrides
      const lastBriefRef = useRef('')
      const thumbRequestedRef = useRef(new Set())
      const iframeRef = useRef(null)
      const step3VideoRef = useRef(null)
      const stageAudioRef = useRef(null)
      const previewAudioRef = useRef(null)
      const fileInputRef = useRef(null)
      const folderInputRef = useRef(null)
      const bgmInputRef = useRef(null)
      const refVideoInputRef = useRef(null)
      const teleImportRef = useRef(null)
      const cloneFileInputRef = useRef(null)
      const avatarBaseInputRef = useRef(null)
      const voiceCloneInputRef = useRef(null)
      const camVideoRef = useRef(null)
      const camStreamRef = useRef(null)
      const camRecorderRef = useRef(null)
      const camTimerRef = useRef(null)
      const camCountdownTimerRef = useRef(null)
      const camAudioCtxRef = useRef(null)
      const camVuRafRef = useRef(0)
      const camChunksRef = useRef([])
      const teleBoxRef = useRef(null)
      const teleRafRef = useRef(0)
      const mediaRecorderRef = useRef(null)
      const micTimerRef = useRef(null)
      const micChunksRef = useRef([])
      const micAudioCtxRef = useRef(null)
      const micVuRafRef = useRef(0)

      const notify = useCallback((message, type = 'info') => {
        setShowRawError(false)
        setToast({ message, type, id: Date.now() })
      }, [])

      useEffect(() => {
        if (!toast || toast.type === 'error') return undefined
        const id = setTimeout(() => setToast(null), 5500)
        return () => clearTimeout(id)
      }, [toast])

      // Inject CSS keyframes + glass utilities dynamically
      const themeCss = useMemo(
        () => `
        .dsh-vw-root { color-scheme: ${resolvedDark ? 'dark' : 'light'}; }
        .dsh-vw-root * { box-sizing: border-box; }
        .dsh-vw-scroll::-webkit-scrollbar { width: 7px; height: 7px; }
        .dsh-vw-scroll::-webkit-scrollbar-track { background: transparent; }
        .dsh-vw-scroll::-webkit-scrollbar-thumb { background: ${T.scrollThumb}; border-radius: 99px; }
        .dsh-vw-btn { transition: background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.2s ease, transform 0.12s ease, opacity 0.15s ease; cursor: pointer; }
        .dsh-vw-btn:hover:not(:disabled) { filter: brightness(1.07); }
        .dsh-vw-btn:active:not(:disabled) { transform: scale(0.982); }
        .dsh-vw-btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .dsh-vw-popover-in { animation: dshPopoverIn 0.14s cubic-bezier(0.16, 1, 0.3, 1); }
        .dsh-vw-plaza-cover img { transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), filter 0.25s ease; }
        .dsh-vw-plaza-cover:hover img, .dsh-vw-plaza-cover:focus-visible img { transform: scale(1.035); filter: brightness(0.82); }
        .dsh-vw-plaza-cover:focus-visible { outline: 2px solid ${T.accentGold}; outline-offset: -2px; }
        .dsh-vw-plaza-play { position: absolute; left: 50%; top: 50%; width: 54px; height: 54px; margin: -27px 0 0 -27px; border-radius: 50%; display: flex; align-items: center; justify-content: center; padding-left: 3px; background: rgba(253, 230, 138, 0.94); box-shadow: 0 0 0 6px rgba(253, 230, 138, 0.22), 0 10px 26px rgba(0, 0, 0, 0.45); transition: transform 0.2s ease, box-shadow 0.2s ease; pointer-events: none; }
        .dsh-vw-plaza-cover:hover .dsh-vw-plaza-play { transform: scale(1.1); box-shadow: 0 0 0 9px rgba(253, 230, 138, 0.28), 0 12px 30px rgba(0, 0, 0, 0.5); }
        .dsh-vw-plaza-video { display: block; max-width: 100%; max-height: 68vh; width: auto; height: auto; background: #000; border-radius: 10px; outline: none; }
        .dsh-vw-plasma-cta {
          position: relative;
          overflow: hidden;
          background: ${resolvedDark ? 'linear-gradient(135deg, #0891B2 0%, #2563EB 50%, #D97706 100%)' : 'linear-gradient(135deg, #0369A1 0%, #1D4ED8 54%, #B45309 100%)'};
          background-size: 200% 200%;
          animation: dshPlasmaShift 6s ease infinite;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.42);
        }
        .dsh-vw-plasma-cta::after {
          content: '';
          position: absolute;
          top: -20%;
          left: -55%;
          width: 42%;
          height: 140%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent);
          transform: skewX(-24deg);
          animation: dshReactorSweep 3.4s ease-in-out infinite;
          pointer-events: none;
        }
        .dsh-vw-rec-dot { animation: dshRecPulse 1.1s ease-in-out infinite; }
        .dsh-vw-topbar { width: 100%; max-width: 100%; min-width: 0; min-height: 54px; padding: 6px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: nowrap; box-sizing: border-box; }
        .dsh-vw-grid-agents { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; align-items: stretch; margin-top: 6px; }
        .dsh-vw-grid-dock { display: grid; grid-template-columns: 1.05fr 1.35fr 1.05fr; gap: 18px; align-items: stretch; }
        .dsh-vw-grid-filmstrip { display: grid; grid-template-columns: 1.6fr 1fr auto; gap: 16px; align-items: center; }
        .dsh-vw-grid-tasks { display: grid; grid-template-columns: 320px 1fr; gap: 18px; align-items: start; }
        .dsh-vw-grid-studio-2col { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start; }
        .dsh-vw-cloud-split { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr); gap: 14px; align-items: start; }
        @media (max-width: 1180px) {
          .dsh-vw-topbar { padding: 6px 10px; gap: 6px; }
          .dsh-vw-grid-agents { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .dsh-vw-grid-dock { grid-template-columns: 1fr; }
          .dsh-vw-grid-filmstrip { grid-template-columns: 1fr; }
          .dsh-vw-grid-tasks { grid-template-columns: 1fr; }
          .dsh-vw-grid-studio-2col { grid-template-columns: 1fr; }
        }
        @media (max-width: 920px) {
          .dsh-vw-topbar { flex-wrap: wrap; row-gap: 6px; }
          .dsh-vw-cloud-split { grid-template-columns: 1fr; }
        }
        @keyframes dshPopoverIn { from { opacity: 0; transform: translateY(-4px) scale(0.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dshReactorSweep { 0% { left: -60%; } 55%, 100% { left: 135%; } }
        @keyframes dshPlasmaShift { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
        @keyframes dshRecPulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.38; transform: scale(0.86); } }
      `,
        [T.scrollThumb, resolvedDark],
      )

      useEffect(() => {
        let el = document.getElementById('dsh-vw-theme-styles')
        if (!el) {
          el = document.createElement('style')
          el.id = 'dsh-vw-theme-styles'
          document.head.appendChild(el)
        }
        el.textContent = themeCss
      }, [themeCss])

      // Main Slot / Shell Overlay Arbitration
      useEffect(() => {
        if (isMainSlot) {
          window.dispatchEvent(new CustomEvent('dsh-video:main-mounted', { detail: { mounted: true } }))
          return () => window.dispatchEvent(new CustomEvent('dsh-video:main-mounted', { detail: { mounted: false } }))
        }
        const onMain = (ev) => setMainSlotActive(Boolean(ev.detail?.mounted))
        window.addEventListener('dsh-video:main-mounted', onMain)
        return () => window.removeEventListener('dsh-video:main-mounted', onMain)
      }, [isMainSlot])

      useEffect(() => {
        const handler = (ev) => {
          if (ev.detail?.mode) setMode(ev.detail.mode)
        }
        window.addEventListener('dsh-video:switch-mode', handler)
        return () => window.removeEventListener('dsh-video:switch-mode', handler)
      }, [])

      // 影核广场 sample player: Esc closes only the player (not the plaza behind it); start playback with sound
      useEffect(() => {
        if (!plazaPlayer) return undefined
        const onKey = (ev) => {
          if (ev.key === 'Escape') {
            ev.stopImmediatePropagation()
            setPlazaPlayer(null)
          }
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [plazaPlayer])

      useEffect(() => {
        if (!plazaPlayer?.previewUrl) return undefined
        setPlazaPlayerState({ error: '', needsTap: false })
        const v = plazaVideoRef.current
        if (!v) return undefined
        try {
          v.muted = false
          v.volume = 1
          const p = v.play()
          if (p && typeof p.catch === 'function') {
            p.catch((err) => {
              if (err?.name === 'NotAllowedError') setPlazaPlayerState((s) => ({ ...s, needsTap: true }))
            })
          }
        } catch {}
        return () => {
          try {
            v.pause()
          } catch {}
        }
      }, [plazaPlayer])

      useEffect(() => {
        const onKey = (ev) => {
          if (ev.key === 'Escape') {
            setShowNewModal(false)
            setShowVoiceModal(false)
            setShowAiHubModal(false)
            setShowCodeDrawer(false)
            setShowVendorModal(false)
            setShowProjectDrawer(false)
            setShowTopMoreMenu(false)
            setShowPlazaModal(false)
            setShowHardwareModal(false)
            setShowProToolsModal(false)
            setPreviewLightboxItem(null)
            setConfirmDeleteDir('')
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      const syncLlmFormFromSummary = (cfg) => {
        if (!cfg) return
        setLlmConfig(cfg)
        setLlmForm({
          mode: cfg.mode === 'custom' ? 'custom' : 'follow-dsh',
          dshProviderId: cfg.dshProviderId || 'active',
          provider: cfg.provider || 'custom',
          format: cfg.format || 'auto',
          baseUrl: cfg.baseUrl || '',
          apiKey: cfg.mode === 'custom' && cfg.hasApiKey ? 'KEEP_EXISTING' : '',
          model: cfg.model || '',
          maxRepairRounds: Number(cfg.maxRepairRounds) || 3,
        })
      }

      const syncTtsFormFromSummary = (cfg) => {
        if (!cfg) return
        const normalized = {
          ...cfg,
          engines: Array.isArray(cfg.engines) && cfg.engines.length ? cfg.engines : DEFAULT_TTS_ENGINES_FALLBACK,
          templates: Array.isArray(cfg.templates) && cfg.templates.length ? cfg.templates : DEFAULT_TTS_TEMPLATES_FALLBACK,
        }
        setTtsConfig(normalized)
        const list = normalized.engines || []
        const idx25 = list.find((e) => e.id === 'indextts25') || {}
        const gsv = list.find((e) => e.id === 'gptvoice') || {}
        const mmTts = list.find((e) => e.id === 'minimax-tts') || {}
        const dbTts = list.find((e) => e.id === 'doubao-tts') || {}
        setBuiltinTtsForm({
          indextts25Endpoint: idx25.endpoint || 'http://127.0.0.1:9880',
          indexttsRootDir: idx25.rootDir || '',
          indexttsPythonBin: idx25.pythonBin || '',
          gptvoiceEndpoint: gsv.endpoint || 'http://127.0.0.1:9881',
          gptvoiceRootDir: gsv.rootDir || '',
          gptvoicePythonBin: gsv.pythonBin || '',
          gptvoiceTextLang: gsv.textLang || 'zh',
          gptvoicePromptLang: gsv.promptLang || 'zh',
          minimaxTtsEndpoint: mmTts.endpoint || 'https://api.minimaxi.com/v1/t2a_v2',
          minimaxTtsModel: mmTts.model || 'speech-2.6-hd',
          minimaxTtsVoiceId: mmTts.voiceId || 'male-qn-qingse',
          minimaxTtsApiKey: '',
          minimaxTtsHasApiKey: Boolean(mmTts.hasApiKey),
          minimaxTtsApiKeyMasked: mmTts.apiKeyMasked || '',
          doubaoTtsEndpoint: dbTts.endpoint || 'https://openspeech.bytedance.com/api/v1/tts',
          doubaoTtsAppId: dbTts.appId || '',
          doubaoTtsToken: '',
          doubaoTtsHasToken: Boolean(dbTts.hasToken),
          doubaoTtsTokenMasked: dbTts.tokenMasked || '',
          doubaoTtsCluster: dbTts.cluster || 'volcano_tts',
          doubaoTtsVoiceType: dbTts.voiceType || 'zh_male_m392_conversation_wvae_bigtts',
        })
      }

      const activeTtsEngineObj =
        (ttsConfig?.engines || []).find((e) => e.id === ttsConfig?.activeEngineId) || {
          id: 'indextts25',
          shortName: 'IndexTTS-2.5',
          name: 'IndexTTS-2.5',
          vramBadge: '推荐 8GB+ 显存',
        }
      const activeTtsLabel = activeTtsEngineObj.shortName || activeTtsEngineObj.name || 'IndexTTS-2.5'

      const refreshState = useCallback(
        async (targetDir = activeProjectDir, opts = {}) => {
          const forceSyncForm = Boolean(opts?.syncForm)
          try {
            const q = targetDir ? `?projectDir=${encodeURIComponent(targetDir)}` : ''
            const res = await connFetch(`/api/video-workbench/state${q}`)
            const data = await res.json()
            if (!data.ok) {
              notify(data.error || '加载工作区失败', 'error')
              return null
            }
            setProjects(data.projects || [])
            setStateRev((r) => r + 1)
            setVoiceCatalog(data.voiceCatalog || [])
            const baseEmotions = ['平静', '高兴', '激昂', '温和', '自信', '严肃', '期待', '深沉', '伤心']
            const extraEmotions = Array.isArray(data.availableEmotions) ? data.availableEmotions : []
            setAvailableEmotions(Array.from(new Set([...baseEmotions, ...extraEmotions])))
            setTtsStatus(data.ttsStatus || { reachable: false, ready: false })
            if (data.hardwareProfile) setHardwareProfile(data.hardwareProfile)
            if (data.hardwarePreferences) setHardwarePreferences(data.hardwarePreferences)
            if (data.hardwarePolicy) setHardwarePolicy(data.hardwarePolicy)
            if (Array.isArray(data.vibeToolkit)) setVibeToolkit(data.vibeToolkit)
            if (data.ttsConfig) syncTtsFormFromSummary(data.ttsConfig)
            if (data.ttsInstallCatalog) setTtsInstallCatalog(data.ttsInstallCatalog)
            if (data.cloudMedia) setCloudMediaCfg(data.cloudMedia)
            if (Array.isArray(data.stagedCloudAssets)) setStagedCloudAssets(data.stagedCloudAssets)
            if (data.plazaBrand) setPlazaBrand(data.plazaBrand)
            if (Array.isArray(data.plazaCategories)) setPlazaCategories(data.plazaCategories)
            if (Array.isArray(data.plazaTemplates)) setPlazaTemplates(data.plazaTemplates)
            if (data.llmConfig) syncLlmFormFromSummary(data.llmConfig)
            if (Array.isArray(data.avatarTemplates)) setAvatarTemplates(data.avatarTemplates)
            if (Array.isArray(data.stylePresets)) setStylePresets(data.stylePresets)
            if (data.avatarProvider) {
              setAvatarProvider(data.avatarProvider)
              setAvatarEndpointForm({
                provider: data.avatarProvider.provider || 'auto',
                endpoint: data.avatarProvider.endpoint || '',
                apiKey: data.avatarProvider.hasApiKey ? 'KEEP_EXISTING' : '',
              })
            }
            if (Array.isArray(data.taskRuns)) {
              setTaskRuns(data.taskRuns)
              const firstId = data.taskRuns[0]?.id || data.taskRuns[0]?.runId
              if (firstId) setSelectedRunId((prev) => prev || firstId)
            }

            if (data.activeProject) {
              const ap = data.activeProject
              const isNewProjectSelection = prevProjectDirRef.current !== ap.projectDir
              prevProjectDirRef.current = ap.projectDir
              setActiveProjectDir(ap.projectDir)
              setScript(ap.script)
              serverScriptRef.current = ap.script || null
              try {
                localStorage.setItem('dsh-vw-last-project', ap.projectDir)
              } catch {}
              setProjectAssets(ap.assets || [])
              setAssetSummary(ap.assetSummary || { image: 0, video: 0, music: 0, sfx: 0, notes: 0, hostVideo: 0, avatarBase: 0, voiceClone: 0 })
              setHasMp4(Boolean(ap.hasMp4))
              setHasReferenceVideo(Boolean(ap.hasReferenceVideo))
              setHasSnapshot(Boolean(ap.hasSnapshot))
              setHasMasterAudio(Boolean(ap.hasMasterAudio))
              setSceneThumbs(ap.sceneThumbs || {})
              setQaReport(ap.qaReport || null)
              setBuildLog(ap.buildLog || null)
              setHistoryCount(Number(ap.historyCount) || 0)
              setScriptDirty(false)

              const isRemotionAi = ap.script?.engine === 'remotion' && ap.script?.authoringMode === 'ai-coded'
              if (isNewProjectSelection) {
                setStep3MonitorSource(ap.hasMp4 && isRemotionAi ? 'final-video' : 'html-draft')
              } else if (ap.hasMp4 && isRemotionAi && step3MonitorSource !== 'html-draft') {
                setStep3MonitorSource('final-video')
              }
              if (
                ap.hasMp4 &&
                Object.keys(ap.sceneThumbs || {}).length === 0 &&
                !thumbRequestedRef.current.has(ap.projectDir)
              ) {
                thumbRequestedRef.current.add(ap.projectDir)
                connFetch('/api/video-workbench/action', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ projectDir: ap.projectDir, action: 'extract-scene-thumbs' }),
                })
                  .then((r) => r.json())
                  .then((td) => {
                    if (td?.ok && td.sceneThumbs) setSceneThumbs(td.sceneThumbs)
                  })
                  .catch(() => {})
              }

              if (ap.script?.avatarClip) {
                setAvatarCfg((prev) => ({
                  ...prev,
                  enabled: true,
                  mode: ap.script.avatarClip.mode || prev.mode,
                  layout: ap.script.avatarLayout || ap.script.avatarClip.layout || prev.layout,
                  presetId: ap.script.avatarClip.presetId || prev.presetId,
                  sourcePath: ap.script.avatarClip.sourceVideoPath || ap.script.avatarClip.sourceImagePath || prev.sourcePath,
                }))
                if (ap.script.avatarClip.visualNotice) {
                  setAvatarVisualNotice(ap.script.avatarClip.visualNotice)
                }
              }

              if (isNewProjectSelection || forceSyncForm) {
                const rawEngine = String(ap.script?.engine || 'remotion').toLowerCase()
                const normEngine = rawEngine === 'html' || rawEngine === 'html5' ? 'html' : 'remotion'
                const BOILERPLATE_GOALS = new Set([
                  '带有文案、配音、音效、动效、音乐与字幕的完整成片',
                  '呈现具备动态视觉排版、空间运镜、粒子光效、节拍音效、配乐与配音的完整成片',
                ])
                const normalizeOutline = (val) => {
                  if (Array.isArray(val)) return val.map((x) => String(x ?? '').trim()).filter(Boolean)
                  const s = String(val ?? '').trim()
                  if (!s) return []
                  const byLines = s.split(/\r?\n+/).map((x) => x.trim().replace(/^[-\d.、\s]+/, '').trim()).filter(Boolean)
                  if (byLines.length > 1) return byLines
                  const legacy = s
                    .split(/(?<=。),|,(?=\s*(?:第\s*\d+\s*步|[\u4e00-\u9fa5A-Za-z0-9｜| ]{2,18}[：:]))/)
                    .map((x) => x.trim().replace(/^[-\d.、\s]+/, '').trim())
                    .filter(Boolean)
                  return legacy.length > 1 ? legacy : byLines
                }
                const resolveDisplayPrompt = (sc) => {
                  if (!sc || typeof sc !== 'object') return ''
                  const rawGoal = cleanBriefText(sc.goal || sc.userPrompt || '').trim()
                  const notes = String(sc.directorNotes || '').trim()
                  const outlineArr = normalizeOutline(sc.contentOutline)
                  const title = String(sc.displayTitle || sc.topic || sc.title || '').trim()
                  const gLabel = String(sc.genreLabel || '').trim()
                  if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal)) {
                    if (/【\s*(?:作品标题|体裁|内容要点|导演备注)/.test(rawGoal) || (!notes && outlineArr.length === 0) || rawGoal.length >= 60) {
                      return rawGoal
                    }
                  }
                  if (notes || outlineArr.length > 0) {
                    const parts = []
                    if (title) parts.push(`【作品标题】${title}`)
                    if (gLabel) parts.push(`【体裁】${gLabel}`)
                    if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal) && rawGoal !== title) parts.push(`【一句话】${rawGoal}`)
                    if (outlineArr.length > 0) parts.push(`【内容要点】\n${outlineArr.map((x, i) => `${i + 1}. ${x}`).join('\n')}`)
                    if (notes) parts.push(`【导演备注（仅供 AI 制作，不会出现在视频里）】\n${notes}`)
                    return parts.join('\n')
                  }
                  if (rawGoal && !BOILERPLATE_GOALS.has(rawGoal)) return rawGoal
                  return title
                }
                const hydratedOutline = normalizeOutline(ap.script?.contentOutline)
                const hydratedPrompt = resolveDisplayPrompt(ap.script)
                lastBriefRef.current = String(hydratedPrompt || '').trim()
                setDirectorForm((prev) => ({
                  ...prev,
                  topic: hydratedPrompt || prev.topic || '',
                  displayTitle: ap.script?.displayTitle || ap.script?.title || prev.displayTitle || '',
                  genre: ap.script?.genre || prev.genre || '',
                  genreLabel: ap.script?.genreLabel || prev.genreLabel || '',
                  directorNotes: ap.script?.directorNotes || prev.directorNotes || '',
                  contentOutline: hydratedOutline.length > 0 ? hydratedOutline : prev.contentOutline || [],
                  style: ap.script ? scriptStyleValue(ap.script) : 'auto',
                  engine: normEngine,
                  creationMode: ap.script?.creationMode || 'ai-coded',
                  bgmMode: ap.script?.bgmMode || ap.script?.audioSpec?.bgmMode || ((ap.assets?.items || []).some((a) => a.role === 'music') ? 'uploaded' : 'llm-coded'),
                  narrationMode: ap.script?.narrationMode || 'tts',
                  pacingMode: ap.script?.pacingMode || 'auto',
                  durationMode: ap.script?.durationMode === 'custom' || Number(ap.script?.targetDurationSec) >= 10 ? 'custom' : 'auto',
                  targetDurationSec: Number(ap.script?.targetDurationSec) >= 10 ? Math.round(Number(ap.script.targetDurationSec)) : (prev.targetDurationSec || 120),
                  visual3dMode: ap.script?.visual3dMode || 'auto',
                  visualReview: ap.script?.visualReview !== false,
                  figureStyleChoice: FIGURE_STYLE_VALUES.includes(ap.script?.figureStyleChoice) ? ap.script.figureStyleChoice : 'auto',
                  figureStyleChoiceNote: cleanFigureNote(ap.script?.figureStyleChoiceNote),
                  targetPlatform: ap.script?.targetPlatform || 'universal',
                  aspectRatio: ap.script?.requestedAspectRatio || ap.script?.aspectRatio || 'auto',
                  quality: ap.script?.quality || '1080p',
                  customWidth: Number(ap.script?.width) || prev.customWidth || 1080,
                  customHeight: Number(ap.script?.height) || prev.customHeight || 1920,
                  aiBadge: ap.script?.aiBadge !== undefined ? Boolean(ap.script.aiBadge) : true,
                  aiBadgeEnabled: ap.script?.aiBadgeEnabled !== undefined ? Boolean(ap.script.aiBadgeEnabled) : (ap.script?.aiBadge !== false),
                  aiBadgePosition: ap.script?.aiBadgePosition || 'top-right',
                  aiBadgeText: ap.script?.aiBadgeText || '',
                  fps: Number(ap.script?.fps) || 30,
                  voiceId: ap.script?.defaultVoiceId || 'auto',
                }))
              }

              if (!initialLoadedRef.current) {
                initialLoadedRef.current = true
                setActiveNav('warroom')
              }
            }
            return data
          } catch (err) {
            notify(`连接后端服务失败: ${err.message}`, 'error')
            return null
          }
        },
        [connFetch, activeProjectDir, notify],
      )

      const updateDirectorAndSync = useCallback(
        (patch) => {
          setDirectorForm((prev) => ({ ...prev, ...patch }))
          // 'auto' / 'user:<id>' are resolved by the backend (script.style always stays a preset): reload the script after
          // the save so the style options (「AI：…」 / 我的预设) follow the project
          const scriptPatch = { ...patch }
          const styleChange = 'style' in scriptPatch
          if (styleChange && !isPresetStyle(scriptPatch.style)) delete scriptPatch.style
          setScript((prev) => (prev ? { ...prev, ...scriptPatch } : prev))
          if (activeProjectDir) {
            connFetch('/api/video-workbench/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                projectDir: activeProjectDir,
                action: 'update-format',
                ...patch,
              }),
            })
              .then(() => {
                if (styleChange) refreshStateRef.current?.()
              })
              .catch(() => {})
          }
        },
        [activeProjectDir, connFetch],
      )

      useEffect(() => {
        let last = ''
        try {
          last = localStorage.getItem('dsh-vw-last-project') || ''
        } catch {}
        // Reopen the project the user had open last time (falls back to the first project when it no longer exists)
        refreshState('').then((d) => {
          if (last && d?.activeProject?.projectDir !== last && (d?.projects || []).some((x) => x.projectDir === last)) refreshState(last)
        })
      }, [])

      useEffect(() => {
        if (!showTtsModal) return
        let cancelled = false
        ;(async () => {
          try {
            const res = await connFetch('/api/video-workbench/tts-config')
            if (!res.ok) {
              if (!cancelled && res.status === 404) setTtsBackendOutdated(true)
              return
            }
            const d = await res.json().catch(() => null)
            if (cancelled || !d?.ok) return
            setTtsBackendOutdated(false)
            if (d.config) syncTtsFormFromSummary(d.config)
            if (d.ttsStatus) setTtsStatus(d.ttsStatus)
          } catch {}
        })()
        return () => {
          cancelled = true
        }
      }, [showTtsModal, connFetch])

      const switchWorkbenchMode = (nextMode) => {
        setMode(nextMode)
        window.dispatchEvent(new CustomEvent('dsh-video:switch-mode', { detail: { mode: nextMode } }))
        if (nextMode === 'video') refreshState(activeProjectDir)
      }

      const handleBackToChat = () => {
        const hl = getHostLayout()
        if (isMainSlot && typeof hl?.selectPanel === 'function') {
          hl.selectPanel(null)
        } else if (!isMainSlot) {
          switchWorkbenchMode('chat')
        } else {
          notify('请点击左侧边栏返回宿主主对话界面', 'info')
        }
      }

      // Safe-zone preflight watcher
      useEffect(() => {
        if (!activeProjectDir) return undefined
        let cancelled = false
        const plat = directorForm.targetPlatform || script?.targetPlatform || 'universal'
        connFetch(`/api/video-workbench/safe-zone?projectDir=${encodeURIComponent(activeProjectDir)}&platform=${encodeURIComponent(plat)}`)
          .then((r) => r.json())
          .then((d) => {
            if (!cancelled && d.ok) setSafeZonePreflight(d.preflight)
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [activeProjectDir, directorForm.targetPlatform, script?.width, script?.height, script?.targetPlatform, assetVersion, connFetch])

      // Live Pipeline Tasks Poller
      const fetchTaskRuns = useCallback(async () => {
        if (!activeProjectDir) return
        try {
          const res = await connFetch(`/api/video-workbench/tasks?projectDir=${encodeURIComponent(activeProjectDir)}`)
          const d = await res.json()
          if (d.ok && Array.isArray(d.runs)) {
            setTaskRuns(d.runs)
            if (d.runs[0]?.id) setSelectedRunId((prev) => prev || d.runs[0].id)
          }
        } catch {}
      }, [activeProjectDir, connFetch])

      const activeProjectTaskRuns = useMemo(
        () => taskRuns.filter((r) => activeProjectDir && r.projectDir === activeProjectDir),
        [taskRuns, activeProjectDir],
      )

      const hasLiveTask = useMemo(
        () => activeProjectTaskRuns.some((r) => r.status === 'running' || r.status === 'paused' || r.status === 'queued'),
        [activeProjectTaskRuns],
      )

      const prevLiveRef = useRef(false)
      useEffect(() => {
        if (prevLiveRef.current && !hasLiveTask && activeProjectDir) {
          // A live pipeline just finished — reload assets, script & switch War Stage to Cinema MP4 Player if ready!
          setAssetVersion((v) => v + 1)
          refreshState(activeProjectDir).then((d) => {
            if (d?.activeProject?.hasMp4) setWarCenterTab('mp4')
          })
        }
        prevLiveRef.current = hasLiveTask
      }, [hasLiveTask, activeProjectDir, refreshState])

      useEffect(() => {
        if (!activeProjectDir || (!hasLiveTask && activeNav !== 'tasks')) return undefined
        const ms = hasLiveTask ? 900 : 3500
        const timer = setInterval(fetchTaskRuns, ms)
        return () => clearInterval(timer)
      }, [activeProjectDir, hasLiveTask, activeNav, fetchTaskRuns])

      // Teleprompter auto-scroll loop
      useEffect(() => {
        if (!teleAutoScroll || !teleBoxRef.current) return undefined
        let raf = 0
        let last = performance.now()
        const tick = (now) => {
          const dt = (now - last) / 1000
          last = now
          if (teleBoxRef.current) teleBoxRef.current.scrollTop += dt * teleScrollSpeed * 38
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
      }, [teleAutoScroll, teleScrollSpeed])

      // Async Job Poller
      const pollBackgroundJob = useCallback(
        async (jobId, { silentBusy = false } = {}) => {
          while (true) {
            await new Promise((r) => setTimeout(r, 750))
            const res = await connFetch(`/api/video-workbench/jobs?id=${encodeURIComponent(jobId)}`)
            const payload = await res.json()
            if (!payload.ok || !payload.job) throw new Error(payload.error || '任务查询失败')
            const job = payload.job
            if (!silentBusy) {
              if (job.message) setBusyLabel(job.message)
              if (Number.isFinite(Number(job.progress))) setBusyProgress(Number(job.progress))
            }
            if (job.status === 'done') return job.result || {}
            if (job.status === 'error') throw new Error(job.error || '后台任务执行失败')
          }
        },
        [connFetch],
      )

      const usingFinalVideoPreview = Boolean(hasMp4 && step3MonitorSource === 'final-video')

      const seekToFrame = useCallback(
        (frame, syncAudio = true) => {
          const fps = Number(script?.fps) || 30
          const total = Math.max(1, Number(script?.totalDurationInFrames) || 300)
          const clamped = Math.max(0, Math.min(total - 1, Math.floor(frame)))
          setCurrentFrame(clamped)
          const targetSec = clamped / fps
          if (usingFinalVideoPreview && step3VideoRef.current) {
            try {
              if (Math.abs((step3VideoRef.current.currentTime || 0) - targetSec) > 0.08) {
                step3VideoRef.current.currentTime = targetSec
              }
            } catch {}
            return
          }
          if (syncAudio && stageAudioRef.current) {
            try {
              if (Math.abs((stageAudioRef.current.currentTime || 0) - targetSec) > 0.12) {
                stageAudioRef.current.currentTime = targetSec
              }
            } catch {}
          }
          const win = iframeRef.current?.contentWindow
          if (win) {
            try {
              if (typeof win.__seekToFrame === 'function') win.__seekToFrame(clamped)
              else win.postMessage({ type: 'dsh-seek', frame: clamped }, '*')
            } catch {
              win.postMessage({ type: 'dsh-seek', frame: clamped }, '*')
            }
          }
        },
        [script, usingFinalVideoPreview],
      )

      useEffect(() => {
        const previewActive = (activeNav === 'studio' && studioStep === 3) || (activeNav === 'warroom' && warCenterTab === 'preview')
        if (usingFinalVideoPreview && step3VideoRef.current && previewActive) {
          try {
            stageAudioRef.current?.pause()
          } catch {}
          const vid = step3VideoRef.current
          if (isPlaying) {
            vid.play().catch(() => setIsPlaying(false))
          } else {
            vid.pause()
          }
          return undefined
        }
        if (!isPlaying || !previewActive) {
          try {
            stageAudioRef.current?.pause()
            step3VideoRef.current?.pause()
          } catch {}
          return undefined
        }
        const fps = Number(script?.fps) || 30
        const total = Math.max(1, Number(script?.totalDurationInFrames) || 300)
        if (hasMasterAudio && stageAudioRef.current) {
          try {
            stageAudioRef.current.currentTime = Math.min((total - 1) / fps, currentFrame / fps)
            stageAudioRef.current.play().catch(() => {})
          } catch {}
        }
        let rafId = 0
        let lastTime = performance.now()
        let acc = currentFrame
        const tick = (now) => {
          const dt = (now - lastTime) / 1000
          lastTime = now
          if (hasMasterAudio && stageAudioRef.current && !stageAudioRef.current.paused) {
            acc = stageAudioRef.current.currentTime * fps
          } else {
            acc += dt * fps
          }
          if (acc >= total - 1) {
            seekToFrame(0, true)
            setIsPlaying(false)
            return
          }
          seekToFrame(acc, false)
          rafId = requestAnimationFrame(tick)
        }
        rafId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(rafId)
      }, [isPlaying, activeNav, studioStep, warCenterTab, script, hasMasterAudio, usingFinalVideoPreview, seekToFrame])

      // Derived Values
      const scenes = useMemo(() => script?.scenes || [], [script])
      useEffect(() => {
        if (scenes.length === 0) setSelectedSceneIdx(0)
        else if (selectedSceneIdx >= scenes.length) setSelectedSceneIdx(scenes.length - 1)
      }, [scenes, selectedSceneIdx])

      const activePlayingSceneIdx = useMemo(() => {
        const idx = scenes.findIndex((s) => {
          const sf = Number(s.startFrame || 0)
          const ef = sf + Math.max(1, Number(s.durationInFrames) || 90)
          return currentFrame >= sf && currentFrame < ef
        })
        return idx >= 0 ? idx : 0
      }, [scenes, currentFrame])


      const specialRoleCount = useMemo(
        () => (assetSummary.hostVideo || 0) + (assetSummary.avatarBase || 0) + (assetSummary.voiceClone || 0),
        [assetSummary],
      )

      const filteredAssets = useMemo(() => {
        if (assetFilter === 'all') return projectAssets
        if (assetFilter === 'music') return projectAssets.filter((a) => a.role === 'music')
        if (assetFilter === 'special') return projectAssets.filter((a) => ['host_video', 'avatar_base', 'voice_clone'].includes(a.role))
        return projectAssets.filter((a) => a.type === assetFilter)
      }, [projectAssets, assetFilter])

      const filteredVoices = useMemo(() => {
        const q = voiceSearch.trim().toLowerCase()
        return voiceCatalog.filter((v) => {
          if (voiceGenderFilter !== 'all' && v.gender !== voiceGenderFilter) return false
          if (!q) return true
          return (
            v.name?.toLowerCase().includes(q) ||
            v.id?.toLowerCase().includes(q) ||
            v.tags?.some((t) => t.toLowerCase().includes(q)) ||
            v.description?.toLowerCase().includes(q)
          )
        })
      }, [voiceCatalog, voiceSearch, voiceGenderFilter])

      const currentTaskRun = useMemo(() => {
        if (!activeProjectTaskRuns.length) return null
        return activeProjectTaskRuns.find((r) => r.id === selectedRunId) || activeProjectTaskRuns[0]
      }, [activeProjectTaskRuns, selectedRunId])

      // 视觉风格 options of the current project (AI 自由匹配 + 6 presets + 我的风格预设); a value is valid when listed
      const warStyleOptions = useMemo(() => buildStyleOptions(script, stylePresets), [script, stylePresets])
      const isStyleValue = (v) => typeof v === 'string' && (v === 'auto' || isPresetStyle(v) || warStyleOptions.styles.some((o) => o.value === v))

      const mountedBgmItem = useMemo(() => {
        const up = script?.bgm?.uploadedPath || script?.bgm?.path
        if (up) {
          const found = projectAssets.find((a) => a.path === up)
          if (found) return found
        }
        return projectAssets.find((a) => a.role === 'music') || null
      }, [script, projectAssets])

      // =======================================================================
      // 6. ACTION HANDLERS (FULL PIPELINE + BINARY UPLOAD + TELEPROMPTER + LLM)
      // =======================================================================
      const handleSelectProject = async (dir) => {
        setIsPlaying(false)
        setPublishPackResult(null)
        setBgmComposePreviewUrl('')
        setSelectedRunId('')
        setShowProjectDrawer(false)
        setActiveProjectDir(dir)
        await refreshState(dir)
      }

      const handleCreateProject = async (titleOverride, options) => {
        const title = String(typeof titleOverride === 'string' && titleOverride.trim() ? titleOverride : newProjectTitle).trim().slice(0, 120) || `影视作品 ${projects.length + 1}`
        const opt = options && typeof options === 'object' && !Array.isArray(options) ? options : {}
        const pick = (key, ok) => (opt[key] !== undefined && ok(opt[key]) ? opt[key] : directorForm[key])
        setBusyLabel('正在创建新工程目录...')
        try {
          const res = await connFetch('/api/video-workbench/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title,
              engine: pick('engine', (v) => v === 'remotion' || v === 'html'),
              // new projects default to 「AI 自由匹配」 (existing projects keep their own style)
              style: opt.style !== undefined && isStyleValue(opt.style) ? opt.style : 'auto',
              aspectRatio: pick('aspectRatio', (v) => ASPECT_RATIO_OPTIONS.some((a) => a.id === v && a.id !== 'custom')),
              quality: pick('quality', (v) => ['720p', '1080p', '2k', '4k'].includes(v)),
              width: directorForm.quality === 'custom' || directorForm.aspectRatio === 'custom' ? Number(directorForm.customWidth) : undefined,
              height: directorForm.quality === 'custom' || directorForm.aspectRatio === 'custom' ? Number(directorForm.customHeight) : undefined,
              aiBadge: directorForm.aiBadgeEnabled,
              aiBadgeEnabled: directorForm.aiBadgeEnabled,
              aiBadgePosition: directorForm.aiBadgePosition || 'top-right',
              aiBadgeText: directorForm.aiBadgeText || '',
              pacingMode: directorForm.pacingMode || 'auto',
              durationMode: directorForm.durationMode || 'auto',
              targetDurationSec: directorForm.durationMode === 'custom' ? Math.max(15, Math.min(600, Math.round(Number(directorForm.targetDurationSec) || 120))) : 0,
              targetPlatform: directorForm.targetPlatform,
              bgmMode: directorForm.bgmMode,
              creationMode: directorForm.creationMode,
              defaultVoiceId: directorForm.voiceId,
            }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(d.error || '新建工程失败', 'error')
            return null
          }
          setShowNewModal(false)
          setShowProjectDrawer(false)
          setNewProjectTitle('')
          setActiveProjectDir(d.projectDir)
          await refreshState(d.projectDir)
          notify(`已新建并切换到工程「${title}」`, 'success')
          return d.projectDir
        } catch (err) {
          notify(`新建工程异常: ${err.message}`, 'error')
          return null
        } finally {
          setBusyLabel('')
        }
      }

      const handleDeleteProject = async (dir) => {
        if (!dir) return
        setBusyLabel('正在删除工程目录...')
        try {
          const res = await connFetch('/api/video-workbench/projects/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectDir: dir }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(d.error || '删除失败', 'error')
            return false
          }
          setConfirmDeleteDir('')
          await refreshState(dir === activeProjectDir ? '' : activeProjectDir)
          notify('工程已清理移除', 'success')
          return true
        } catch (err) {
          notify(`删除工程异常: ${err.message}`, 'error')
          return false
        } finally {
          setBusyLabel('')
        }
      }

      const applyAutoBoundAssets = (autoBound) => {
        if (!autoBound || typeof autoBound !== 'object') return []
        const notes = []
        if (autoBound.bgm) {
          setDirectorForm((p) => ({ ...p, bgmMode: 'uploaded' }))
          const bpmTxt = autoBound.bgm.bpm ? ` · ${autoBound.bgm.bpm} BPM` : ''
          const dropTxt = autoBound.bgm.dropsCount ? ` · ${autoBound.bgm.dropsCount} 个高潮突降点` : ''
          notes.push(`🎵 已自动切换并绑定上传 BGM「${autoBound.bgm.name}」${bpmTxt}${dropTxt}`)
        }
        if (autoBound.avatarBase?.path) {
          setAvatarCfg((p) => ({ ...p, sourcePath: autoBound.avatarBase.path }))
          notes.push(`👤 已绑定数字人底板「${autoBound.avatarBase.name}」`)
        }
        if (autoBound.voiceClone?.path) {
          setAvatarCfg((p) => ({ ...p, voiceSamplePath: autoBound.voiceClone.path }))
          notes.push(`🎤 已绑定声音克隆样本「${autoBound.voiceClone.name}」`)
        }
        if (autoBound.hostVideo?.path) {
          setUseHostVocal(true)
          notes.push(`🎬 已启用真人出镜原声「${autoBound.hostVideo.name}」`)
        }
        return notes
      }

      // Raw Binary Streaming Upload (Zero Base64 bloat on large MP4s!)
      const handleUploadFiles = async (fileList, forcedRole = '') => {
        const files = Array.from(fileList || []).filter(Boolean)
        if (!files.length || !activeProjectDir) return 0
        let uploadedCount = 0
        let lastManifestItems = null
        let lastSummary = null
        const boundNotes = []
        try {
          for (let i = 0; i < files.length; i += 1) {
            const file = files[i]
            setUploadProgressState({
              current: i + 1,
              total: files.length,
              fileName: file.name,
              percent: Math.round(((i + 0.4) / files.length) * 100),
            })
            const localPath = typeof file.path === 'string' ? file.path : ''
            const q = `projectDir=${encodeURIComponent(activeProjectDir)}&fileName=${encodeURIComponent(file.name)}&role=${encodeURIComponent(forcedRole || '')}&localPath=${encodeURIComponent(localPath)}`
            let bodyPayload = file
            try {
              const ab = await file.arrayBuffer()
              bodyPayload = new Uint8Array(ab)
            } catch {}
            const res = await connFetch(`/api/video-workbench/assets/upload?${q}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: bodyPayload,
            })
            const d = await res.json()
            if (!d.ok) {
              notify(`文件「${file.name}」上传失败: ${d.error}`, 'error')
            } else {
              uploadedCount += d.matchedCount || d.addedCount || d.uploadedCount || 1
              if (Array.isArray(d.manifest?.items)) lastManifestItems = d.manifest.items
              if (d.summary) lastSummary = d.summary
              boundNotes.push(...applyAutoBoundAssets(d.autoBound))
            }
          }
          if (uploadedCount > 0) {
            if (lastManifestItems) setProjectAssets(lastManifestItems)
            if (lastSummary) setAssetSummary(lastSummary)
            if (assetFilter !== 'all') setAssetFilter('all')
            setAssetVersion((v) => v + 1)
            await refreshState(activeProjectDir)
            notify(
              boundNotes.length > 0
                ? `已导入 ${uploadedCount} 个素材 · ${boundNotes[0]}`
                : `已高速流式导入 ${uploadedCount} 个素材文件`,
              'success',
            )
          }
        } catch (err) {
          notify(`上传过程中出错: ${err.message}`, 'error')
        } finally {
          setUploadProgressState(null)
        }
        return uploadedCount
      }

      const handleDeleteAsset = async (assetId) => {
        if (!activeProjectDir || !assetId) return false
        try {
          const res = await connFetch('/api/video-workbench/assets/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectDir: activeProjectDir, assetId }),
          })
          const d = await res.json()
          if (d.ok) {
            await refreshState(activeProjectDir)
            notify('素材已移除', 'info')
            return true
          }
          notify(`移除素材失败: ${d.error || '未知错误'}`, 'error')
        } catch (err) {
          notify(`移除素材失败: ${err.message}`, 'error')
        }
        return false
      }

      const handlePolishTopic = async (overrideTopic) => {
        const rawPrompt = String(typeof overrideTopic === 'string' ? overrideTopic : directorForm.topic || '').trim()
        if (!rawPrompt) {
          notify('请先在框里写一句简单想法（例如：帮我做一个墨次元漫画客户端介绍片），再点 AI 润色', 'info')
          return false
        }
        if (!llmConfig?.configured) {
          setShowLlmModal(true)
          notify('请先在右上角「模型配置」连接大模型接口，才能使用 AI 润色指令', 'info')
          return false
        }
        setPolishingTopic(true)
        try {
          const res = await connFetch('/api/video-workbench/polish-topic', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              async: true,
              projectDir: activeProjectDir,
              rawPrompt,
              style: directorForm.style,
              aspectRatio: directorForm.aspectRatio,
              targetPlatform: directorForm.targetPlatform,
              pacingMode: directorForm.pacingMode,
              durationMode: directorForm.durationMode || 'auto',
              targetDurationSec: directorForm.durationMode === 'custom' ? Math.max(15, Math.min(600, Math.round(Number(directorForm.targetDurationSec) || 120))) : 0,
              creationMode: directorForm.creationMode,
              narrationMode: directorForm.narrationMode,
            }),
          })
          const initD = await res.json()
          if (!initD.ok) {
            notify(`AI 润色失败: ${initD.error || '请求未成功'}`, 'error')
            return false
          }
          const d = initD.jobId ? await pollBackgroundJob(initD.jobId, { silentBusy: true }) : initD
          if (!d.ok || !d.polishedTopic) {
            notify(`AI 润色失败: ${d.error || '未返回有效指令'}`, 'error')
            return false
          }
          setUnpolishedTopicBackup(rawPrompt)
          const resolvedDurMode = d.durationMode === 'custom' ? 'custom' : (directorForm.durationMode || 'auto')
          const resolvedDurSec = Number(d.targetDurationSec) >= 10
            ? Math.round(Number(d.targetDurationSec))
            : (resolvedDurMode === 'custom' ? Math.max(15, Math.min(600, Math.round(Number(directorForm.targetDurationSec) || 120))) : 0)
          const resolvedNarrMode = ['subtitle-mv', 'tts-beat-sync', 'tts'].includes(String(d.suggestedNarrationMode || ''))
            ? d.suggestedNarrationMode
            : directorForm.narrationMode
          const resolvedPacingMode = ['dynamic', 'balanced', 'calm', 'auto'].includes(String(d.suggestedPacingMode || '')) && d.suggestedPacingMode !== 'auto'
            ? d.suggestedPacingMode
            : directorForm.pacingMode
          setDirectorForm((p) => ({
            ...p,
            topic: d.polishedTopic,
            displayTitle: d.displayTitle || p.displayTitle,
            genre: d.genre || p.genre,
            genreLabel: d.genreLabel || p.genreLabel,
            durationMode: resolvedDurMode,
            targetDurationSec: resolvedDurSec || p.targetDurationSec || 120,
            narrationMode: resolvedNarrMode,
            pacingMode: resolvedPacingMode,
            directorNotes: d.directorNotes || '',
            contentOutline: Array.isArray(d.contentOutline) ? d.contentOutline : [],
            // 「AI 自由匹配」 and 我的预设 stay the user's choice; otherwise take the polish's suggestion
            style: p.style === 'auto' || String(p.style || '').startsWith('user:') || !isPresetStyle(d.suggestedStyle) ? p.style : d.suggestedStyle,
          }))
          if (activeProjectDir && script) {
            try {
              await connFetch('/api/video-workbench/script', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  projectDir: activeProjectDir,
                  script: {
                    ...script,
                    title: d.displayTitle || script.title,
                    topic: d.displayTitle || script.topic,
                    displayTitle: d.displayTitle || '',
                    genre: d.genre || '',
                    genreLabel: d.genreLabel || '',
                    durationMode: resolvedDurMode,
                    targetDurationSec: resolvedDurSec,
                    narrationMode: resolvedNarrMode,
                    pacingMode: resolvedPacingMode,
                    directorNotes: d.directorNotes || '',
                    contentOutline: Array.isArray(d.contentOutline) ? d.contentOutline : [],
                    goal: d.polishedTopic,
                  },
                  regenerateHtml: false,
                  regenerateCode: false,
                }),
              })
            } catch {}
          }
          notify(
            resolvedDurSec >= 10
              ? `✨ 已由 ${d.model || 'AI 大模型'} 按目标时长 ${d.durationLabel || `${resolvedDurSec}秒`} 润色生成专业导演指令${resolvedNarrMode === 'subtitle-mv' ? '（已自动切换为纯音乐卡点免TTS）' : ''}！`
              : `✨ 已由 ${d.model || 'AI 大模型'} 润色生成专业导演指令并覆盖替换！`,
            'success',
          )
          return true
        } catch (err) {
          notify(`AI 润色请求异常: ${err.message}`, 'error')
          return false
        } finally {
          setPolishingTopic(false)
        }
      }

      const handleUploadReferenceVideo = async (file) => {
        if (!file || !activeProjectDir) {
          notify('请先新建或选择一个视频工程后再上传参考视频', 'info')
          return
        }
        setRefAnalyzing(true)
        setBusyLabel(`🎯 正在上传并拆解参考视频「${file.name}」的镜头节奏、节拍与视觉基因...`)
        setBusyProgress(15)
        try {
          const uploadUrl = `/api/video-workbench/reference/upload?projectDir=${encodeURIComponent(activeProjectDir)}&fileName=${encodeURIComponent(file.name)}&extractAudioAsBgm=${refExtractAudio ? '1' : '0'}&async=1`
          const res = await connFetch(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          })
          const initD = await res.json()
          if (!initD.ok) {
            notify(`参考视频上传拆解失败: ${initD.error || '请求失败'}`, 'error')
            return
          }
          const finalD = initD.jobId ? await pollBackgroundJob(initD.jobId) : initD
          if (!finalD?.ok || !finalD?.referenceStyle) {
            notify(`参考视频拆解异常: ${finalD?.error || '未返回风格基因'}`, 'error')
            return
          }
          const rs = finalD.referenceStyle
          setAssetVersion((v) => v + 1)
          await refreshState(activeProjectDir, { syncForm: true })
          notify(
            `🎯 参考视频拆解完成！实测 ${rs.shotCount || 0} 镜 · ${rs.bpm || '?'} BPM · 已生成同款复刻基因与 MOTION.md，现在直接写你的新主题即可一键复刻同款！`,
            'success',
          )
        } catch (err) {
          notify(`参考视频拆解异常: ${err.message}`, 'error')
        } finally {
          setRefAnalyzing(false)
          setBusyLabel('')
          setBusyProgress(0)
        }
      }

      const handleCommitStagedAsset = async (item) => {
        if (!item?.stagingId || !activeProjectDir) return false
        setStagingActionBusy(item.stagingId)
        try {
          const res = await connFetch('/api/video-workbench/cloud-media/staging/commit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectDir: activeProjectDir,
              stagingId: item.stagingId,
              sceneId: item.sceneId || cloudGenSceneId || '',
              bindAsBgm: item.category === 'audio',
            }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(`入库失败: ${d.error || '未知错误'}`, 'error')
            return false
          }
          if (Array.isArray(d.remainingStaging)) setStagedCloudAssets(d.remainingStaging)
          await refreshState(activeProjectDir)
          setAssetVersion((v) => v + 1)
          notify(`✓ 已确认采用并正式存入项目素材库：${d.path || item.fileName}`, 'success')
          return true
        } catch (err) {
          notify(`入库异常: ${err.message}`, 'error')
          return false
        } finally {
          setStagingActionBusy('')
        }
      }

      const handleDiscardStagedAsset = async (stagingId = '', clearAll = false) => {
        if (!activeProjectDir) return false
        setStagingActionBusy(clearAll ? '__all__' : stagingId)
        try {
          const res = await connFetch('/api/video-workbench/cloud-media/staging/discard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectDir: activeProjectDir, stagingId, clearAll }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(`清理暂存失败: ${d.error || '未知错误'}`, 'error')
            return false
          }
          if (Array.isArray(d.remainingStaging)) setStagedCloudAssets(d.remainingStaging)
          // like commit: re-read host data so the war-room state (rev) and every open panel see the change
          await refreshState(activeProjectDir)
          notify(clearAll ? '已清空暂存预览区' : '已移除该暂存预览项', 'info')
          return true
        } catch (err) {
          notify(`清理暂存失败: ${err.message}`, 'error')
          return false
        } finally {
          setStagingActionBusy('')
        }
      }

      const applyServerOverrides = (map) => {
        const next = map && typeof map === 'object' ? map : {}
        setScript((prev) => (prev ? { ...prev, userOverrides: next } : prev))
        if (serverScriptRef.current) serverScriptRef.current = { ...serverScriptRef.current, userOverrides: next }
      }

      const handleUpdateHardwareMode = async (nextMode, forceRefresh = false) => {
        setHardwareRefreshing(true)
        try {
          const res = await connFetch('/api/video-workbench/hardware', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lowSpecMode: nextMode || hardwarePreferences?.lowSpecMode || 'auto',
              quality: directorForm.quality || '1080p',
              fps: Number(directorForm.fps) || 30,
              forceRefresh,
            }),
          })
          const d = await res.json()
          if (d.ok) {
            if (d.hardwareProfile) setHardwareProfile(d.hardwareProfile)
            if (d.hardwarePreferences) setHardwarePreferences(d.hardwarePreferences)
            if (d.hardwarePolicy) setHardwarePolicy(d.hardwarePolicy)
            if (Array.isArray(d.vibeToolkit)) setVibeToolkit(d.vibeToolkit)
            notify(`算力模式已更新：${d.hardwarePolicy?.reason || nextMode}`, 'success')
          }
        } catch (err) {
          notify(`算力检测更新失败: ${err.message}`, 'error')
        } finally {
          setHardwareRefreshing(false)
        }
      }

      // One-Click 4-Agent Collaborative Pipeline Launch
      const handleStartOneClickPipeline = async (overrideMode, overrides = {}) => {
        if (!activeProjectDir) return null
        const modeToRun = (typeof overrideMode === 'string' && overrideMode) || directorForm.creationMode || 'ai-coded'
        const topicText = String(typeof overrides?.topic === 'string' ? overrides.topic : directorForm.topic || '').trim()
        if (modeToRun === 'ai-coded' && !llmConfig?.configured) {
          setShowLlmModal(true)
          notify('尚未配置 AI 大模型接口，请先填入 API Key 或切换为「本地草稿预演」一键生成', 'info')
          return null
        }
        setBusyLabel('🚀 正在唤醒 4 位 AI Agent 作战团队流水线...')
        try {
          const prevBrief = String(lastBriefRef.current || '').trim()
          const sceneOverrideIds = Object.keys(script?.userOverrides || {}).filter((k) => k !== '__project__')
          if (topicText && prevBrief && topicText !== prevBrief && sceneOverrideIds.length > 0) {
            try {
              const cr = await connFetch('/api/video-workbench/project/scene-overrides/batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectDir: activeProjectDir, clear: true }),
              })
              const cd = await cr.json().catch(() => null)
              if (cd?.ok) {
                applyServerOverrides(cd.userOverrides)
                notify(`检测到新的创意需求：已清除旧分镜的 ${sceneOverrideIds.length} 处人工改动保护（锁定的分镜仍会原样保留）`, 'info')
              }
            } catch {}
          }
          const uploadedMusicAsset = projectAssets.find((a) => a.role === 'music')
          const res = await connFetch('/api/video-workbench/pipeline/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              projectDir: activeProjectDir,
              topic: topicText || script?.title || 'AI 影视概念短片',
              userPrompt: topicText || script?.goal || '',
              goal: topicText || script?.goal || '',
              displayTitle: directorForm.displayTitle || undefined,
              genre: directorForm.genre || undefined,
              genreLabel: directorForm.genreLabel || undefined,
              directorNotes: directorForm.directorNotes || undefined,
              contentOutline: Array.isArray(directorForm.contentOutline) && directorForm.contentOutline.length > 0 ? directorForm.contentOutline : undefined,
              mode: modeToRun,
              engine: directorForm.engine,
              style: directorForm.style,
              aspectRatio: directorForm.aspectRatio,
              quality: directorForm.quality,
              width: directorForm.quality === 'custom' || directorForm.aspectRatio === 'custom' ? Number(directorForm.customWidth) : undefined,
              height: directorForm.quality === 'custom' || directorForm.aspectRatio === 'custom' ? Number(directorForm.customHeight) : undefined,
              targetPlatform: directorForm.targetPlatform,
              bgmMode: directorForm.bgmMode,
              narrationMode: directorForm.narrationMode,
              pacingMode: directorForm.pacingMode || 'auto',
              durationMode: directorForm.durationMode || 'auto',
              targetDurationSec: directorForm.durationMode === 'custom' ? Math.max(15, Math.min(600, Math.round(Number(directorForm.targetDurationSec) || 120))) : 0,
              visual3dMode: directorForm.visual3dMode || 'auto',
              visualReview: directorForm.visualReview !== false,
              figureStyleChoice: FIGURE_STYLE_VALUES.includes(directorForm.figureStyleChoice) ? directorForm.figureStyleChoice : 'auto',
              figureStyleChoiceNote: cleanFigureNote(directorForm.figureStyleChoiceNote),
              fps: Number(directorForm.fps) || 30,
              uploadedBgmPath: script?.bgm?.uploadedPath || uploadedMusicAsset?.path || '',
              voiceId: directorForm.voiceId,
              speechTempo: Number(speechTempo) || 1.0,
              useHostVocal: Boolean(useHostVocal),
              aiBadge: Boolean(directorForm.aiBadgeEnabled),
              aiBadgeEnabled: Boolean(directorForm.aiBadgeEnabled),
              aiBadgePosition: directorForm.aiBadgePosition || 'top-right',
              aiBadgeText: directorForm.aiBadgeText || '',
              avatarEnabled: Boolean(avatarCfg.enabled),
              avatarMode: avatarCfg.mode,
              avatarLayout: avatarCfg.layout,
              avatarPresetId: avatarCfg.presetId,
              avatarSourcePath: avatarCfg.sourcePath,
              voiceSamplePath: avatarCfg.voiceSamplePath,
              avatarChromaKeyColor: avatarCfg.chromaKeyColor,
              trimSeconds: Number(trimClipSec) || 0,
              clipSpeed: Number(clipSpeedMult) || 1.0,
              aiAuthorCode: Boolean(aiAuthorCode),
              lowSpecMode: hardwarePreferences?.lowSpecMode || 'auto',
            }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(`流水线启动失败: ${d.error}`, 'error')
            return null
          }
          if (Array.isArray(d.runs)) setTaskRuns(d.runs)
          if (d.runId) setSelectedRunId(d.runId)
          setWarCenterTab('theater')
          if (topicText) lastBriefRef.current = topicText
          notify('⚡ AI Agent 团队已全速启动！你可在大屏直观观看实时产出与交接过程', 'success')
          return { runId: d.runId || d.run?.id || '' }
        } catch (err) {
          notify(`启动失败: ${err.message}`, 'error')
          return null
        } finally {
          setBusyLabel('')
        }
      }

      const handleTaskControl = async (action, runId = currentTaskRun?.id, taskId = '') => {
        if (!activeProjectDir) return false
        try {
          const res = await connFetch('/api/video-workbench/tasks/control', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, runId, projectDir: activeProjectDir, taskId }),
          })
          const d = await res.json()
          if (!d.ok) {
            notify(d.error || '控制指令执行失败', 'error')
            return false
          }
          if (Array.isArray(d.runs)) setTaskRuns(d.runs)
          const map = { pause: '已暂停任务', resume: '已恢复执行', stop: '已停止任务与子进程', retry: '已发起重新执行', 'pause-all': '已全部暂停', 'stop-all': '已紧急停止全部任务' }
          notify(map[action] || '操作成功', action.includes('stop') ? 'info' : 'success')
          return true
        } catch (err) {
          notify(`任务控制异常: ${err.message}`, 'error')
          return false
        }
      }

      // 3-Mode Audio / BGM
      const handleUploadBgmFile = async (file) => {
        if (!activeProjectDir || !file) return
        setBusyLabel(`正在高速导入配乐「${file.name}」...`)
        try {
          const res = await connFetch(`/api/video-workbench/bgm/upload?projectDir=${encodeURIComponent(activeProjectDir)}&fileName=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file,
          })
          const d = await res.json()
          if (!d.ok) {
            notify(`上传 BGM 失败: ${d.error}`, 'error')
            return
          }
          setDirectorForm((p) => ({ ...p, bgmMode: 'uploaded' }))
          setAssetVersion((v) => v + 1)
          await refreshState(activeProjectDir)
          notify(`已绑定背景音乐「${d.asset?.name || file.name}」（混音时人声进入自动闪避压低）`, 'success')
        } catch (err) {
          notify(`上传 BGM 出错: ${err.message}`, 'error')
        } finally {
          setBusyLabel('')
        }
      }

      const handlePickCloneFile = async (file) => {
        if (!file) return
        const b64 = await readFileAsBase64(file)
        setRecordedB64(b64)
        setRecordedFileName(file.name)
        if (!cloneVoiceName.trim()) setCloneVoiceName(file.name.replace(/\.[^.]+$/, ''))
        notify(`已载入参考人声「${file.name}」，请点第 ② 步按钮完成降噪克隆`, 'info')
      }

      // =======================================================================
      // 7. SHARED STYLE OBJECTS & ASSET URLS
      // =======================================================================


      const goldBtnStyle = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '10px 18px',
        borderRadius: '11px',
        background: resolvedDark ? 'linear-gradient(135deg, #F5B942, #D97706)' : 'linear-gradient(135deg, #0F172A, #1E293B)',
        border: resolvedDark ? '1px solid rgba(255,228,160,0.42)' : '1px solid rgba(15,23,42,0.28)',
        color: resolvedDark ? '#07090F' : '#FFFFFF',
        fontSize: '13.5px',
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }



      const masterAudioUrl =
        activeProjectDir && hasMasterAudio
          ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(activeProjectDir)}&rel=output/master-audio.wav&v=${assetVersion}`
          : ''
      const mp4Url =
        activeProjectDir && hasMp4
          ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(activeProjectDir)}&rel=output/final.mp4&v=${assetVersion}`
          : ''


      // =======================================================================
      // 7a. 工程安全与高级工具 + 专业交付 handlers (routes-project.js / routes-delivery.js)
      // =======================================================================
      const proApi = useCallback(
        async (path, { method = 'GET', query = null, body = null } = {}) => {
          const qs = query
            ? `?${Object.entries(query)
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                .join('&')}`
            : ''
          const res = await connFetch(`${path}${qs}`, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
          })
          const d = await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))
          if (!res.ok && d.ok !== false) d.ok = false
          return d
        },
        [connFetch],
      )
      const loadProTab = useCallback(
        async (tab) => {
          if (tab === 'lipsync') {
            const d = await proApi('/api/video-workbench/avatar/lipsync').catch(() => null)
            if (d?.ok && d.lipsync) setLipsyncStatus(d.lipsync)
            return
          }
          if (!activeProjectDir) return
          try {
            if (tab === 'history') {
              setProHistory(await proApi('/api/video-workbench/project/history', { query: { projectDir: activeProjectDir, limit: 60 } }))
            } else if (tab === 'locks') {
              setProSceneEdits(await proApi('/api/video-workbench/project/scene-edits', { query: { projectDir: activeProjectDir } }))
            } else if (tab === 'characters') {
              setProCharacters(await proApi('/api/video-workbench/project/characters', { query: { projectDir: activeProjectDir, scope: 'all' } }))
            } else if (tab === 'cloudjobs') {
              setProCloudJobs(await proApi('/api/video-workbench/project/cloud-jobs', { query: { projectDir: activeProjectDir, limit: 80, plan: 1 } }))
            }
          } catch (err) {
            notify(`读取失败: ${err.message}`, 'error')
          }
        },
        [activeProjectDir, proApi, notify],
      )
      useEffect(() => {
        if (showProToolsModal) loadProTab(proToolsTab)
      }, [showProToolsModal, proToolsTab, activeProjectDir, loadProTab])


      // 专业交付 · 示波器 · 深度质检
      useEffect(() => {
        if (activeNav !== 'studio' || studioStep !== 4 || deliveryLuts.length) return
        proApi('/api/video-workbench/color-lut')
          .then((d) => {
            if (d?.ok && Array.isArray(d.luts)) setDeliveryLuts(d.luts)
          })
          .catch(() => {})
      }, [activeNav, studioStep, deliveryLuts.length, proApi])

      // =======================================================================
      // 7b. WAR-ROOM SKIN BRIDGE (host side · contract: lib/warroom/BRIDGE.md)
      // Builds the WarRoomState snapshot from real backend data, pushes it (≤ 5/s) into the skin iframe and
      // maps every skin action onto the existing, tested React handlers. The skin never calls the backend.
      // =======================================================================
      const isStandaloneHost = typeof window !== 'undefined' && Boolean(window.__DSH_STANDALONE__)
      const warSkinMeta = WARROOM_SKINS.find((s) => s.id === warSkin) || null
      const warSkinPending = Boolean(warSkinMeta) && warSkinCatalog === null
      const warSkinAvailable = Boolean(warSkinMeta) && (warSkinCatalog === false || Boolean(warSkinCatalog && warSkinCatalog[warSkinMeta.id] !== false))
      const warSkinActive = (warSkinPending || warSkinAvailable) && warSkinPhase !== 'failed'
      const warSkinReady = warSkinActive && warSkinPhase === 'ready'
      // 注意：location.origin 只是 URL 的源，沙箱化宿主里文档真实源是 'null'（window.origin 为 null），
      // 用它当 targetOrigin 会让每一条 dsh-vw/state 被浏览器静默丢弃，作战大屏永远停在「正在连接宿主」。
      // 因此必须取 window.origin（真实文档源），不可用时退回通配源。
      const warSkinTargetOrigin = (() => {
        try {
          const o = typeof window.origin === 'string' ? window.origin : ''
          if (o && o !== 'null') return o
        } catch {}
        return '*'
      })()

      const refreshWarSkinCatalog = useCallback(() => {
        connFetch('/api/video-workbench/warroom/skins')
          .then((r) => r.json())
          .then((d) => {
            if (d?.ok && Array.isArray(d.skins)) setWarSkinCatalog(Object.fromEntries(d.skins.map((s) => [s.id, Boolean(s.available)])))
            else setWarSkinCatalog((c) => c || false)
          })
          .catch(() => setWarSkinCatalog((c) => c || false))
      }, [connFetch])
      useEffect(() => {
        refreshWarSkinCatalog()
      }, [refreshWarSkinCatalog])

      useEffect(() => {
        let cancelled = false
        connFetch('/api/video-workbench/avatar/lipsync')
          .then((r) => r.json())
          .then((d) => {
            if (!cancelled && d?.ok && d.lipsync) setLipsyncStatus(d.lipsync)
          })
          .catch(() => {})
        return () => {
          cancelled = true
        }
      }, [connFetch])

      // Skin picker popover: close on outside click / Esc
      useEffect(() => {
        if (!showSkinMenu) return undefined
        const onDown = (ev) => {
          if (skinMenuRef.current && !skinMenuRef.current.contains(ev.target)) setShowSkinMenu(false)
        }
        const onKey = (ev) => {
          if (ev.key === 'Escape') setShowSkinMenu(false)
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [showSkinMenu])

      // No dsh-vw/ready in time → recovery screen (retry / switch to another skin).
      useEffect(() => {
        if (!warSkinActive || warSkinPhase !== 'loading') return undefined
        const timer = setTimeout(() => setWarSkinPhase((p) => (p === 'loading' ? 'failed' : p)), WARROOM_READY_TIMEOUT_MS)
        return () => clearTimeout(timer)
      }, [warSkinActive, warSkinPhase, warSkin, warSkinReloadKey])

      const warStaticOptions = useMemo(() => {
        const o = (pairs) => pairs.map(([value, label]) => ({ value, label }))
        return {
          engines: o([
            ['remotion', 'Remotion + Three.js 3D'],
            ['html', 'HTML5 + Three.js'],
          ]),
          creationModes: o([
            ['ai-coded', '大模型编码大片'],
            ['fast-draft', '本地极速草稿'],
          ]),
          aspectRatios: ASPECT_RATIO_OPTIONS.filter((a) => a.id !== 'custom').map((a) => ({ value: a.id, label: a.label, hint: a.sub })),
          qualities: o([
            ['720p', '720P 极速预览'],
            ['1080p', '1080P 全高清'],
            ['2k', '2K 超清'],
            ['4k', '4K 超清母带'],
          ]),
          narrationModes: o([
            ['tts', 'AI 真人配音'],
            ['tts-beat-sync', '配音 + 踩拍切镜'],
            ['subtitle-mv', '纯音乐卡点 MV（免配音）'],
          ]),
          bgmModes: o([
            ['llm-coded', 'AI 写代码作曲'],
            ['uploaded', '使用已上传 BGM'],
            ['tts-engine', 'TTS 氛围音景'],
          ]),
          pacingModes: o([
            ['auto', 'AI 自动节奏'],
            ['calm', '舒缓叙事 (4~7s/镜)'],
            ['balanced', '稳健解说 (3~5s/镜)'],
            ['dynamic', '高燃踩点 (0.5~3s/镜)'],
          ]),
          avatarLayouts: o([
            ['pip-br', '右下画中画'],
            ['pip-bl', '左下画中画'],
            ['fullscreen', '全屏口播'],
          ]),
        }
      }, [])
      const warVoiceOptions = useMemo(
        () => [
          { value: 'auto', label: 'AI 自动匹配' },
          ...(Array.isArray(voiceCatalog) ? voiceCatalog : [])
            .filter((v) => v && v.id && v.available !== false)
            .map((v) => ({ value: String(v.id), label: v.category ? `${v.name || v.id} · ${v.category}` : String(v.name || v.id) })),
        ],
        [voiceCatalog],
      )

      const warRoomState = useMemo(() => {
        if (!warSkinActive || !warSkinMeta) return null
        const dir = activeProjectDir || ''
        const num = (v, d = 0) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : d
        }
        const assetUrl = (rel) =>
          dir && rel ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(dir)}&rel=${encodeURIComponent(rel)}&v=${assetVersion}` : ''
        const fps = num(script?.fps, 30) || 30
        const rawScenes = dir && Array.isArray(script?.scenes) ? script.scenes : []

        // Timeline scenes (absolute seconds) + SFX cues converted from scene-relative offsets
        let cursor = 0
        const tlScenes = rawScenes.map((sc, i) => {
          const start = Number.isFinite(Number(sc?.startSec))
            ? Number(sc.startSec)
            : Number.isFinite(Number(sc?.startFrame))
              ? Number(sc.startFrame) / fps
              : cursor
          const dur = num(sc?.durationSec) > 0 ? num(sc.durationSec) : num(sc?.durationInFrames) > 0 ? num(sc.durationInFrames) / fps : 3
          cursor = start + dur
          const thumbRel = (sceneThumbs && sc?.id && sceneThumbs[sc.id]) || ''
          return {
            id: String(sc?.id || `scene-${i + 1}`),
            index: i,
            title: String(sc?.title || sc?.tag || `第 ${i + 1} 幕`),
            startSec: +start.toFixed(3),
            durationSec: +dur.toFixed(3),
            subtitle: String(sc?.subtitleText || sc?.narration || sc?.subtitleLine || '').trim(),
            thumbUrl: assetUrl(thumbRel),
            hasVoice: Boolean(sc?.audioFile || sc?.masteredAudioFile),
            sfx: (Array.isArray(sc?.sfxCues) ? sc.sfxCues : [])
              .slice(0, 24)
              .map((c) => ({ type: String(c?.type || 'sfx'), t: +(start + num(c?.offsetSec ?? c?.t)).toFixed(3) })),
            locked: sc?.locked === true || sc?.locked === 'true' || sc?.locked === 1,
          }
        })
        const totalSec = num(script?.totalDurationSec) > 0 ? num(script.totalDurationSec) : tlScenes.reduce((m, s) => Math.max(m, s.startSec + s.durationSec), 0)

        // Beats / drops / music lane from the analysed BGM
        const bgm = (dir && script?.bgm) || {}
        let beats = (Array.isArray(bgm.beats) ? bgm.beats : [])
          .map((b) => ({ t: num(b?.time ?? b?.t, -1), strong: Boolean(b?.strong), drop: Boolean(b?.isDrop) }))
          .filter((b) => b.t >= 0 && (!totalSec || b.t <= totalSec + 0.5))
        const dropSet = new Set()
        for (const d of Array.isArray(bgm.drops) ? bgm.drops : []) {
          const t = typeof d === 'number' ? d : num(d?.time ?? d?.t ?? d?.sec, NaN)
          if (Number.isFinite(t) && t >= 0) dropSet.add(+t.toFixed(3))
        }
        for (const b of beats) if (b.drop) dropSet.add(+b.t.toFixed(3))
        if (beats.length > 600) {
          const strong = beats.filter((b) => b.strong)
          const step = Math.ceil(strong.length / 600)
          beats = strong.length <= 600 ? strong : strong.filter((_, i) => i % step === 0)
        }
        const music = []
        const bgmRel = String(bgm.uploadedPath || bgm.path || bgm.audioPath || '')
        if (bgm.enabled !== false && bgmRel) {
          const base = bgmRel.split(/[\\/]/).pop()
          const label = bgm.source === 'llm-coded' ? 'AI 编曲配乐' : bgm.source === 'tts-engine' ? 'TTS 氛围音景' : ''
          music.push({ name: label ? `${label} · ${base}` : base, startSec: 0, endSec: +(totalSec || num(bgm.durationSec)).toFixed(3) })
        }

        // Asset library (+ which scenes reference each asset, to drive the fly-into-timeline choreography)
        const sceneRefs = rawScenes.map((sc) => {
          const refs = []
          const add = (v) => {
            if (!v) return
            if (typeof v === 'string') refs.push(v)
            else if (typeof v === 'object') {
              for (const k of ['assetId', 'path', 'originalPath', 'webPath', 'src']) if (typeof v[k] === 'string' && v[k]) refs.push(v[k])
            }
          }
          for (const key of ['media', 'assetPaths', 'fanMedia', 'poolMedia']) {
            const arr = sc?.[key]
            if (Array.isArray(arr)) arr.forEach(add)
            else add(arr)
          }
          for (const key of ['bgVideo', 'hostVideo', 'image', 'video', 'mediaPath', 'imagePath', 'videoPath']) add(sc?.[key])
          return { id: String(sc?.id || ''), refs }
        })
        const kindOf = (a) => {
          const role = String(a?.role || '')
          if (role === 'host_video' || role === 'avatar_base') return 'host_video'
          if (role === 'voice_clone') return 'voice'
          if (a?.type === 'image') return 'image'
          if (a?.type === 'video') return 'video'
          if (role === 'music') return 'music'
          if (role === 'sfx') return 'sfx'
          return 'other'
        }
        const assets = (dir && Array.isArray(projectAssets) ? projectAssets : []).map((a) => {
          const id = String(a?.id || '')
          const kind = kindOf(a)
          const edited = String(a?.editedPath || '')
          const usedBySceneIds = id
            ? sceneRefs
                .filter((s) => s.id && s.refs.some((r) => r === a.path || (edited && r === edited) || r === id || (id.length >= 6 && r.includes(id))))
                .map((s) => s.id)
            : []
          return {
            id,
            kind,
            name: String(a?.originalName || a?.name || id),
            url: assetUrl(a?.path),
            thumbUrl: assetUrl(a?.thumb || (kind === 'image' ? a?.path : '')),
            durationSec: num(a?.durationSec) > 0 ? +num(a.durationSec).toFixed(2) : null,
            width: num(a?.width) > 0 ? num(a.width) : null,
            height: num(a?.height) > 0 ? num(a.height) : null,
            usedBySceneIds,
          }
        })
        const staging = (dir && Array.isArray(stagedCloudAssets) ? stagedCloudAssets : [])
          .map((it) => {
            const url = assetUrl(it?.relPath)
            const kind = it?.category === 'video' ? 'video' : it?.category === 'audio' ? 'audio' : 'image'
            return {
              id: String(it?.stagingId || ''),
              kind,
              name: String(it?.title || it?.fileName || it?.stagingId || ''),
              url,
              thumbUrl: kind === 'image' ? url : '',
              provider: [it?.providerId, it?.model].filter(Boolean).join(' · '),
              prompt: String(it?.prompt || ''),
            }
          })
          .filter((s) => s.id)

        // Run + 8 agents (real task-center data mapped onto the visual agent roster)
        const run = dir ? currentTaskRun : null
        const runTerminal = run && ['completed', 'failed', 'stopped'].includes(run.status)
        const tasks = Array.isArray(run?.tasks) ? run.tasks : []
        const byAgent = {}
        for (const t of tasks) {
          const ag = WARROOM_TASK_AGENT[t?.id]
          if (ag) byAgent[ag] = t
        }
        const agentStatusOf = (st) =>
          ({ completed: 'done', running: 'running', paused: 'paused', failed: 'failed', stopped: 'stopped' })[st] ||
          (runTerminal ? 'skipped' : 'queued')
        const hasReference = Boolean(script?.referenceStyle) || Boolean(hasReferenceVideo)
        const agents = WARROOM_AGENT_DEFS.map(([id, name, en]) => {
          const t = byAgent[id]
          if (t) return { id, name, en, status: agentStatusOf(t.status), progress: Math.max(0, Math.min(100, Math.round(num(t.progress)))), message: String(t.message || t.error || '') }
          if (id === 'cloud') {
            if (cloudGenBusy) return { id, name, en, status: 'running', progress: 50, message: '云端生成中…' }
            if (staging.length) return { id, name, en, status: 'done', progress: 100, message: `${staging.length} 个云端结果待确认入库` }
            return { id, name, en, status: run ? 'skipped' : 'idle', progress: 0, message: run ? '本次未调用云端生成' : '待命 · 可在 AI 引擎中心生图 / 视频 / 配乐' }
          }
          if (id === 'reference') {
            if (hasReference)
              return { id, name, en, status: 'done', progress: 100, message: script?.referenceStyle?.genreLabel ? `已解析参考片：${script.referenceStyle.genreLabel}` : '已解析参考视频风格基因' }
            return { id, name, en, status: run ? 'skipped' : 'idle', progress: 0, message: run ? '本次未使用参考片' : '待命 · 上传参考视频即可同款复刻' }
          }
          if (id === 'avatar') {
            return { id, name, en, status: run ? 'skipped' : 'idle', progress: 0, message: run ? '本次未启用数字人' : avatarCfg.enabled ? '已启用 · 将随流水线生成' : '待命' }
          }
          return { id, name, en, status: run ? (runTerminal ? 'skipped' : 'queued') : 'idle', progress: 0, message: run ? '' : '待命' }
        })
        const liveTask = tasks.find((t) => t?.status === 'running') || tasks.find((t) => t?.status === 'paused')
        let activeAgentId = liveTask ? WARROOM_TASK_AGENT[liveTask.id] || null : null
        if (!activeAgentId && run && (run.status === 'queued' || run.status === 'idle')) activeAgentId = 'director'
        if (!activeAgentId && run && run.status === 'failed') {
          const ft = tasks.find((t) => t?.status === 'failed')
          activeAgentId = ft ? WARROOM_TASK_AGENT[ft.id] || null : null
        }
        const runLogs = Array.isArray(run?.logs) ? run.logs : []
        const logAgent = (lg) => {
          const st = String(lg?.stage || '')
          const text = String(lg?.message || '')
          if (st === 'director' || st === 'editor' || st === 'avatar') return st
          if (st === 'audio') return /数字人|口型|唇形|avatar|lipsync/i.test(text) ? 'avatar' : 'audio'
          if (st === 'motion_qa' || st === 'motion' || st === 'render') return /渲染|MP4|导出|成品|编码|响度|质检报告/i.test(text) ? 'qa' : 'motion'
          return 'system'
        }
        const logs = runLogs.slice(-60).map((lg) => ({
          ts: String(lg?.ts || ''),
          agentId: logAgent(lg),
          level: lg?.level === 'error' ? 'error' : lg?.level === 'warn' || lg?.level === 'warning' ? 'warn' : 'info',
          text: String(lg?.message || ''),
        }))
        if (!logs.length) {
          logs.push({
            ts: new Date().toISOString(),
            agentId: 'system',
            level: 'info',
            text: dir ? '工作台就绪 · 8 位 AI Agent 待命，写下创意后点击「一键出片」' : '欢迎使用 DSH AI 视频工坊 · 请先新建或打开一个工程',
          })
        }
        const lastLog = runLogs[runLogs.length - 1]
        const runObj = run
          ? {
              id: String(run.id || run.runId || ''),
              status: run.status === 'idle' ? 'queued' : String(run.status || 'queued'),
              progress: Math.max(0, Math.min(100, Math.round(num(run.progress)))),
              activeAgentId,
              elapsedSec: Math.round(num(run.elapsedMs) / 1000),
              error: run.errorKind === 'billing'
                ? `⛔ 计费停止：${String(run.billingStop?.message || run.error || '账户余额不足')}（不会自动重试，充值后可重新执行）`
                : String(run.error || ''),
              errorKind: String(run.errorKind || ''),
              message: String(liveTask?.message || lastLog?.message || ''),
            }
          : null

        const projMeta = dir ? projects.find((x) => (x.projectDir || x.dir) === dir) || {} : null
        const rawEngine = String(script?.engine || projMeta?.engine || 'remotion').toLowerCase()
        const project = dir
          ? {
              dir,
              title: String(script?.displayTitle || script?.title || projMeta?.name || projMeta?.title || '未命名工程'),
              engine: rawEngine === 'html' || rawEngine === 'html5' ? 'html' : 'remotion',
              aspectRatio: String(script?.aspectRatio || script?.requestedAspectRatio || directorForm.aspectRatio || 'auto'),
              width: num(script?.width, 1920) || 1920,
              height: num(script?.height, 1080) || 1080,
              fps,
              quality: String(script?.quality || directorForm.quality || '1080p'),
              genreLabel: String(script?.genreLabel || directorForm.genreLabel || ''),
              style: String(script?.style || directorForm.style || ''),
              narrationMode: String(script?.narrationMode || directorForm.narrationMode || 'tts'),
              durationSec: +totalSec.toFixed(2),
            }
          : null

        const gpu = hardwareProfile?.gpu || {}
        const gpuName = String(gpu.primaryName || '')
          .replace(/\((?:TM|R)\)/gi, '')
          .replace(/^NVIDIA\s+/i, '')
          .replace(/^GeForce\s+/i, '')
          .replace(/\s*Laptop GPU$/i, '')
          .replace(/\s+/g, ' ')
          .trim()
        const lipsyncEngine = String(lipsyncStatus?.engine || '')
        const lipsyncLabel = !lipsyncStatus
          ? '检测中'
          : lipsyncEngine === 'musetalk'
            ? 'MuseTalk 1.5'
            : lipsyncEngine === 'cloud-fal'
              ? 'fal LatentSync'
              : lipsyncEngine === 'latentsync'
                ? 'LatentSync'
                : lipsyncEngine === 'cli'
                  ? '自定义口型引擎'
                  : '未启用'

        return {
          v: 1,
          ts: Date.now(),
          skin: warSkinMeta.id,
          host: isStandaloneHost ? 'standalone' : 'dsh',
          lowSpec: Boolean(hardwarePolicy?.lowSpecSafe || hardwarePreferences?.lowSpecMode === 'safe'),
          busy: busyLabel
            ? `${busyLabel}${busyProgress > 0 && busyProgress < 100 ? ` · ${Math.round(busyProgress)}%` : ''}`
            : uploadProgressState
              ? `正在上传素材 ${uploadProgressState.current}/${uploadProgressState.total}：${uploadProgressState.fileName}`
              : polishingTopic
                ? 'AI 正在润色导演指令…'
                : stagingActionBusy
                  ? '正在处理云端生成结果…'
                  : '',
          project,
          projects: (Array.isArray(projects) ? projects : []).map((p) => ({
            dir: String(p.projectDir || p.dir || ''),
            title: String(p.name || p.title || '未命名工程'),
            engine: String(p.engine || 'remotion'),
            updatedAt: String(p.updatedAt || ''),
            hasMp4: Boolean(p.hasMp4),
          })),
          assets,
          staging,
          run: runObj,
          agents,
          logs,
          timeline: {
            totalSec: +totalSec.toFixed(3),
            fps,
            bpm: num(bgm.bpm) > 0 ? Math.round(num(bgm.bpm)) : null,
            beats: beats.map((b) => ({ t: +b.t.toFixed(3), strong: b.strong })),
            drops: [...dropSet].sort((a, b) => a - b),
            scenes: tlScenes,
            music,
          },
          preview: {
            mp4Url: dir && hasMp4 ? assetUrl('output/final.mp4') : '',
            posterUrl: tlScenes.find((s) => s.thumbUrl)?.thumbUrl || (dir && hasSnapshot ? assetUrl('output/snapshot-3x3.png') : ''),
            hasMp4: Boolean(dir && hasMp4),
            durationSec: dir && hasMp4 ? +totalSec.toFixed(2) : 0,
          },
          director: {
            topic: String(directorForm.topic || ''),
            engine: directorForm.engine === 'html' || directorForm.engine === 'html5' ? 'html' : 'remotion',
            creationMode: directorForm.creationMode === 'local-draft' || directorForm.creationMode === 'fast-draft' ? 'fast-draft' : 'ai-coded',
            aspectRatio: String(directorForm.aspectRatio || 'auto'),
            quality: String(directorForm.quality || '1080p'),
            fps: num(directorForm.fps, 30) || 30,
            durationMode: directorForm.durationMode === 'custom' ? 'custom' : 'auto',
            targetDurationSec: num(directorForm.targetDurationSec, 120) || 120,
            narrationMode: String(directorForm.narrationMode || 'tts'),
            bgmMode: String(directorForm.bgmMode || 'llm-coded'),
            pacingMode: String(directorForm.pacingMode || 'auto'),
            style: String(directorForm.style || 'auto'),
            voiceId: String(directorForm.voiceId || 'auto'),
            avatarEnabled: Boolean(avatarCfg.enabled),
            avatarLayout: ['pip-br', 'pip-bl', 'fullscreen'].includes(avatarCfg.layout) ? avatarCfg.layout : 'pip-br',
            displayTitle: String(directorForm.displayTitle || ''),
            genre: String(directorForm.genre || ''),
            genreLabel: String(directorForm.genreLabel || ''),
            directorNotes: String(directorForm.directorNotes || ''),
            contentOutline: Array.isArray(directorForm.contentOutline) ? directorForm.contentOutline.map((x) => String(x ?? '')) : [],
            bgmTtsPrompt: String(directorForm.bgmTtsPrompt || ''),
            targetPlatform: String(directorForm.targetPlatform || 'universal'),
            customWidth: num(directorForm.customWidth, 1080) || 1080,
            customHeight: num(directorForm.customHeight, 1920) || 1920,
            aiBadgeEnabled: Boolean(directorForm.aiBadgeEnabled),
            aiBadgePosition: String(directorForm.aiBadgePosition || 'top-right'),
            aiBadgeText: String(directorForm.aiBadgeText || ''),
            visual3dMode: String(directorForm.visual3dMode || 'auto'),
            visualReview: directorForm.visualReview !== false,
            figureStyleChoice: FIGURE_STYLE_VALUES.includes(directorForm.figureStyleChoice) ? directorForm.figureStyleChoice : 'auto',
            figureStyleChoiceNote: cleanFigureNote(directorForm.figureStyleChoiceNote),
            useDraftReference: directorForm.useDraftReference !== false,
          },
          runOptions: {
            speechTempo: num(speechTempo, 1) || 1,
            useHostVocal: Boolean(useHostVocal),
            aiAuthorCode: Boolean(aiAuthorCode),
            trimClipSec: num(trimClipSec, 0),
            clipSpeedMult: num(clipSpeedMult, 1) || 1,
          },
          avatar: {
            enabled: Boolean(avatarCfg.enabled),
            mode: avatarCfg.mode === 'cloned-human' ? 'cloned-human' : 'ai-human',
            layout: ['pip-br', 'pip-bl', 'fullscreen'].includes(avatarCfg.layout) ? avatarCfg.layout : 'pip-br',
            presetId: String(avatarCfg.presetId || ''),
            sourcePath: String(avatarCfg.sourcePath || ''),
            voiceSamplePath: String(avatarCfg.voiceSamplePath || ''),
            chromaKeyColor: String(avatarCfg.chromaKeyColor || ''),
          },
          rev: stateRev,
          projectFlags: {
            hasReferenceVideo: Boolean(dir && hasReferenceVideo),
            hasSnapshot: Boolean(dir && hasSnapshot),
            hasMasterAudio: Boolean(dir && hasMasterAudio),
            hasQaReport: Boolean(dir && qaReport),
            historyCount: dir ? num(historyCount, 0) : 0,
          },
          options: {
            ...warStaticOptions,
            voices: warVoiceOptions,
            platforms: PLATFORM_OPTIONS.map((p) => ({ value: p.id, label: p.label, hint: p.hint })),
            aiBadgePositions: [
              { value: 'top-right', label: '右上角（推荐）' },
              { value: 'top-left', label: '左上角' },
              { value: 'bottom-right', label: '右下角' },
              { value: 'bottom-left', label: '左下角' },
            ],
            figureStyles: FIGURE_STYLE_OPTIONS,
            visual3dModes: [
              { value: 'auto', label: 'AI 按需自由创作（推荐）' },
              { value: 'on', label: '偏好 3D 与全息 HUD 科技感' },
              { value: 'off', label: '偏好纯 2D 平面动效' },
            ],
            avatarModes: [
              { value: 'ai-human', label: 'AI 虚拟主播' },
              { value: 'cloned-human', label: '克隆真人（上传 / 录制本人）' },
            ],
            avatarPresets: (Array.isArray(avatarTemplates) ? avatarTemplates : []).map((t) => ({ value: String(t?.id || ''), label: String(t?.name || t?.label || t?.id || '') })).filter((t) => t.value),
            emotions: (Array.isArray(availableEmotions) ? availableEmotions : []).map((e) => ({ value: String(e), label: String(e) })),
            sceneLayouts: SCENE_LAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.label, hint: o.sub })),
            threePresets: THREE_PRESET_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            kenBurns: MOTION_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
            // AI 自由匹配 + 6 presets + 我的风格预设: `styles` for the skins (the project's AI pick shown as 「AI：…」),
            // `styleCards` for the panel kit / new-project dialog
            styles: warStyleOptions.styles,
            styleCards: warStyleOptions.styleCards,
          },
          status: {
            llm: { configured: Boolean(llmConfig?.configured), label: llmConfig?.configured ? String(llmConfig?.model || '已连接') : '未配置' },
            tts: { ready: Boolean(ttsStatus?.ready), label: String(activeTtsLabel || 'TTS') },
            gpu: { label: gpuName ? `${gpuName}${num(gpu.vramGB) > 0 ? ` · ${Math.round(num(gpu.vramGB))} GB` : ''}` : 'CPU 模式', lowSpecMode: String(hardwarePreferences?.lowSpecMode || 'auto') },
            lipsync: { ready: Boolean(lipsyncStatus?.ready), label: lipsyncLabel },
          },
          counts: { plazaTemplates: Array.isArray(plazaTemplates) ? plazaTemplates.length : 0, voices: Array.isArray(voiceCatalog) ? voiceCatalog.length : 0 },
        }
      }, [
        warSkinActive,
        warSkinMeta,
        isStandaloneHost,
        activeProjectDir,
        assetVersion,
        script,
        sceneThumbs,
        projectAssets,
        stagedCloudAssets,
        currentTaskRun,
        cloudGenBusy,
        hasReferenceVideo,
        avatarCfg,
        projects,
        directorForm,
        hasMp4,
        hasSnapshot,
        warStaticOptions,
        warVoiceOptions,
        warStyleOptions,
        llmConfig,
        ttsStatus,
        activeTtsLabel,
        hardwareProfile,
        hardwarePreferences,
        hardwarePolicy,
        lipsyncStatus,
        busyLabel,
        busyProgress,
        uploadProgressState,
        polishingTopic,
        stagingActionBusy,
        plazaTemplates,
        voiceCatalog,
        speechTempo,
        useHostVocal,
        aiAuthorCode,
        trimClipSec,
        clipSpeedMult,
        stateRev,
        hasMasterAudio,
        qaReport,
        historyCount,
        avatarTemplates,
        availableEmotions,
      ])
      const warStateRef = useRef(null)
      warStateRef.current = warRoomState

      const postToSkin = useCallback(
        (msg, transfer) => {
          const win = warSkinFrameRef.current?.contentWindow
          if (!win) return false
          try {
            win.postMessage({ v: 1, ...msg }, warSkinTargetOrigin, transfer || undefined)
            return true
          } catch {
            return false
          }
        },
        [warSkinTargetOrigin],
      )

      // Throttled full-snapshot push (≤ 5/s, trailing edge always delivers the newest state)
      const warPostTimerRef = useRef(0)
      const warLastPostRef = useRef(0)
      const flushWarState = useCallback(() => {
        if (warPostTimerRef.current) {
          clearTimeout(warPostTimerRef.current)
          warPostTimerRef.current = 0
        }
        warLastPostRef.current = Date.now()
        const st = warStateRef.current
        if (st) postToSkin({ type: 'dsh-vw/state', state: { ...st, ts: Date.now() } })
      }, [postToSkin])
      useEffect(() => {
        if (!warSkinReady || !warRoomState) return undefined
        const wait = 200 - (Date.now() - warLastPostRef.current)
        if (wait <= 0) flushWarState()
        else if (!warPostTimerRef.current) warPostTimerRef.current = setTimeout(flushWarState, wait)
        return undefined
      }, [warRoomState, warSkinReady, flushWarState])
      useEffect(
        () => () => {
          if (warPostTimerRef.current) clearTimeout(warPostTimerRef.current)
        },
        [],
      )

      const releaseSkinFocus = () => {
        try {
          const frame = warSkinFrameRef.current
          if (frame && document.activeElement === frame) frame.blur()
          window.focus()
        } catch {}
      }

      const warTopicRef = useRef(directorForm.topic)
      warTopicRef.current = directorForm.topic
      // Brief fields edited in the war room (topic → script.goal, title, genre, notes, outline) used to live only in memory,
      // so reopening the project brought the old brief back. Save them through `update-format` (it merges just the given
      // fields into script.json), debounced; pending edits are written at once on project switch and page close.
      const briefPersistRef = useRef({ dir: '', fields: null, timer: 0, retries: 0 })
      // urgent = the page / project may be going away (pagehide, project switch): only then use `keepalive`, whose quota
      // is 64 KiB of BYTES in flight (a long Chinese brief is 3 bytes per character). A failed save is merged back
      // (newer edits win) and retried a few times instead of being dropped silently.
      const flushBriefPersist = useCallback((urgent = false) => {
        const st = briefPersistRef.current
        if (st.timer) clearTimeout(st.timer)
        st.timer = 0
        if (!st.dir || !st.fields) return
        const dir = st.dir
        const fields = st.fields
        const body = JSON.stringify({ projectDir: dir, action: 'update-format', ...fields })
        st.fields = null
        const keepalive = urgent === true && new TextEncoder().encode(body).length < 60000
        connFetch('/api/video-workbench/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive })
          .then((r) => {
            if (r && r.ok === false) throw new Error(`HTTP ${r.status}`)
            briefPersistRef.current.retries = 0
          })
          .catch(() => {
            const cur = briefPersistRef.current
            if (cur.dir !== dir) return
            cur.fields = { ...fields, ...(cur.fields || {}) }
            if (urgent !== true && !cur.timer && cur.retries < 3) {
              cur.retries += 1
              cur.timer = setTimeout(() => flushBriefPersist(false), 3000)
            }
          })
      }, [connFetch])
      const queueBriefPersist = (fields) => {
        const st = briefPersistRef.current
        if (st.dir && st.dir !== activeProjectDir) flushBriefPersist(true)
        if (!activeProjectDir) return
        if (st.dir !== activeProjectDir) st.retries = 0
        st.dir = activeProjectDir
        st.fields = { ...(st.fields || {}), ...fields }
        if (st.timer) clearTimeout(st.timer)
        st.timer = setTimeout(() => flushBriefPersist(false), 800)
      }
      useEffect(() => () => flushBriefPersist(true), [activeProjectDir, flushBriefPersist])
      useEffect(() => {
        const onHide = () => flushBriefPersist(true)
        window.addEventListener('pagehide', onHide)
        return () => window.removeEventListener('pagehide', onHide)
      }, [flushBriefPersist])
      const applySkinDirectorPatch = (patch) => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('参数格式错误')
        const has = (list, v) => list.some((o) => o.value === v)
        const local = {}
        const sync = {}
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'topic') {
            local.topic = cleanBriefText(v)
            warTopicRef.current = local.topic
          } else if (k === 'engine' && (v === 'remotion' || v === 'html')) sync.engine = v
          else if (k === 'creationMode' && (v === 'ai-coded' || v === 'fast-draft' || v === 'local-draft')) sync.creationMode = v === 'ai-coded' ? 'ai-coded' : 'local-draft'
          else if (k === 'aspectRatio' && has(warStaticOptions.aspectRatios, v)) sync.aspectRatio = v
          else if (k === 'quality' && has(warStaticOptions.qualities, v)) sync.quality = v
          else if (k === 'fps' && [24, 25, 30, 50, 60].includes(Number(v))) sync.fps = Number(v)
          else if (k === 'durationMode') sync.durationMode = v === 'custom' ? 'custom' : 'auto'
          else if (k === 'targetDurationSec') {
            const n = Math.round(Number(v))
            if (n >= 15 && n <= 600) {
              sync.targetDurationSec = n
              if (patch.durationMode === undefined) sync.durationMode = 'custom'
            }
          } else if (k === 'narrationMode' && has(warStaticOptions.narrationModes, v)) sync.narrationMode = v
          else if (k === 'bgmMode' && has(warStaticOptions.bgmModes, v)) sync.bgmMode = v
          else if (k === 'pacingMode' && has(warStaticOptions.pacingModes, v)) sync.pacingMode = v
          else if (k === 'style' && isStyleValue(v)) sync.style = v
          else if (k === 'voiceId' && (v === 'auto' || (Array.isArray(voiceCatalog) && voiceCatalog.some((x) => x.id === v)))) sync.voiceId = v
          else if (k === 'avatarEnabled') setAvatarCfg((p) => ({ ...p, enabled: Boolean(v) }))
          else if (k === 'avatarLayout' && has(warStaticOptions.avatarLayouts, v)) setAvatarCfg((p) => ({ ...p, layout: v }))
          else if (k === 'aspectRatio' && v === 'custom') sync.aspectRatio = 'custom'
          else if (k === 'quality' && v === 'custom') sync.quality = 'custom'
          else if (k === 'displayTitle' || k === 'genre' || k === 'genreLabel') local[k] = String(v ?? '').slice(0, 200)
          else if (k === 'directorNotes' || k === 'bgmTtsPrompt') local[k] = String(v ?? '').slice(0, 8000)
          else if (k === 'contentOutline')
            local.contentOutline = (Array.isArray(v) ? v : String(v ?? '').split(/\r?\n+/))
              .map((x) => String(x ?? '').trim())
              .filter(Boolean)
              .slice(0, 80)
              .map((x) => x.slice(0, 800))
          else if ((k === 'customWidth' || k === 'customHeight') && Number(v) >= 240 && Number(v) <= 7680) local[k] = Math.round(Number(v) / 2) * 2
          else if (k === 'useDraftReference') local.useDraftReference = Boolean(v)
          else if (k === 'targetPlatform' && PLATFORM_OPTIONS.some((o) => o.id === v)) sync.targetPlatform = v
          else if (k === 'aiBadgeEnabled') {
            sync.aiBadgeEnabled = Boolean(v)
            sync.aiBadge = Boolean(v)
          } else if (k === 'aiBadgePosition' && ['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(v)) sync.aiBadgePosition = v
          else if (k === 'aiBadgeText') sync.aiBadgeText = String(v ?? '').slice(0, 40)
          else if (k === 'visual3dMode' && ['auto', 'on', 'off'].includes(v)) sync.visual3dMode = v
          else if (k === 'visualReview') sync.visualReview = Boolean(v)
          else if (k === 'figureStyleChoice' && FIGURE_STYLE_VALUES.includes(v)) sync.figureStyleChoice = v
          else if (k === 'figureStyleChoiceNote') sync.figureStyleChoiceNote = cleanFigureNote(v)
          else if (k === 'speechTempo' && Number(v) >= 0.5 && Number(v) <= 2) setSpeechTempo(Number(v))
          else if (k === 'useHostVocal') setUseHostVocal(Boolean(v))
          else if (k === 'aiAuthorCode') setAiAuthorCode(Boolean(v))
          else if (k === 'trimClipSec' && Number(v) >= 0 && Number(v) <= 600) setTrimClipSec(Number(v))
          else if (k === 'clipSpeedMult' && Number(v) >= 0.25 && Number(v) <= 4) setClipSpeedMult(Number(v))
        }
        if (Object.keys(local).length) setDirectorForm((p) => ({ ...p, ...local }))
        if (Object.keys(sync).length) updateDirectorAndSync(sync)
        const persist = {}
        if ('topic' in local) persist.goal = local.topic
        for (const k of ['displayTitle', 'genre', 'genreLabel', 'directorNotes', 'contentOutline']) if (k in local) persist[k] = local[k]
        if (Object.keys(persist).length) queueBriefPersist(persist)
      }

      const applySkinAvatarPatch = (patch) => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('参数格式错误')
        const next = {}
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'enabled') next.enabled = Boolean(v)
          else if (k === 'mode' && (v === 'ai-human' || v === 'cloned-human')) next.mode = v
          else if (k === 'layout' && ['pip-br', 'pip-bl', 'fullscreen'].includes(v)) next.layout = v
          else if (k === 'presetId' && typeof v === 'string' && v.length <= 120) next.presetId = v
          else if ((k === 'sourcePath' || k === 'voiceSamplePath') && typeof v === 'string' && v.length <= 2000) next[k] = v
          else if (k === 'chromaKeyColor' && (v === '' || /^#[0-9a-f]{6}$/i.test(String(v)))) next.chromaKeyColor = String(v)
        }
        if (Object.keys(next).length) setAvatarCfg((p) => ({ ...p, ...next }))
      }

      // ---- Panel-kit bridge: generic JSON / binary proxies for the native in-skin panels (allow-listed routes only) ----
      const refreshStateRef = useRef(refreshState)
      refreshStateRef.current = refreshState
      const kitRefreshTimerRef = useRef(0)
      const kitAfterMutation = (body) => {
        try {
          if (body && typeof body === 'object' && body.autoBound) applyAutoBoundAssets(body.autoBound)
        } catch {}
        setAssetVersion((v) => v + 1)
        if (kitRefreshTimerRef.current) clearTimeout(kitRefreshTimerRef.current)
        kitRefreshTimerRef.current = setTimeout(() => {
          kitRefreshTimerRef.current = 0
          refreshStateRef.current?.()
        }, 250)
      }
      const kitReadResponse = async (res) => {
        const ct = String(res?.headers?.get?.('content-type') || '')
        if (ct.includes('json')) return await res.json().catch(() => null)
        const text = await res.text().catch(() => '')
        return { ok: Boolean(res?.ok), text: text.length > 400000 ? text.slice(0, 400000) : text }
      }
      const kitPath = (raw) =>
        String(raw || '')
          .trim()
          .replace(/^\/+/, '')
          .replace(/^api\/video-workbench\//, '')
          .replace(/\/+$/, '')
      const kitQuery = (query) => {
        const q = new URLSearchParams()
        if (query && typeof query === 'object' && !Array.isArray(query)) {
          for (const [k, v] of Object.entries(query)) {
            if (v === undefined || v === null || v === '') continue
            q.set(String(k), typeof v === 'object' ? JSON.stringify(v) : String(v))
          }
        }
        const s = q.toString()
        return s ? `?${s}` : ''
      }
      const kitApiCall = async (payload) => {
        const method = String(payload?.method || 'GET').toUpperCase()
        const path = kitPath(payload?.path)
        if (method !== 'GET' && method !== 'POST') throw new Error(`不支持的请求方法：${method}`)
        if (!(method === 'GET' ? KIT_API_GET : KIT_API_POST).has(path)) throw new Error(`面板接口未开放：${method} ${path || '(空)'}`)
        const init =
          method === 'GET'
            ? {}
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload?.body && typeof payload.body === 'object' ? payload.body : {}) }
        const res = await connFetch(`/api/video-workbench/${path}${kitQuery(payload?.query)}`, init)
        const body = await kitReadResponse(res)
        if (method === 'POST' && !KIT_API_NO_REFRESH.has(path)) kitAfterMutation(body)
        return { status: Number(res?.status) || 0, body }
      }
      const kitUploadCall = async (payload) => {
        const path = kitPath(payload?.path)
        if (!KIT_UPLOAD_PATHS.has(path)) throw new Error(`上传接口未开放：${path || '(空)'}`)
        const data = payload?.data
        if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) throw new Error('上传数据格式错误（需要 ArrayBuffer）')
        const res = await connFetch(`/api/video-workbench/${path}${kitQuery(payload?.query)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: data,
        })
        const body = await kitReadResponse(res)
        kitAfterMutation(body)
        return { status: Number(res?.status) || 0, body }
      }
      const KIT_ASSET_ROLE_RE = /^[a-z_]{0,24}$/

      const handleWarSkinAction = async (msg) => {
        const id = msg?.id
        const action = String(msg?.action || '')
        const payload = msg?.payload && typeof msg.payload === 'object' ? msg.payload : {}
        const reply = (ok, extra = {}) => postToSkin({ type: 'dsh-vw/result', id, ok, ...extra })
        const needProject = () => {
          if (!activeProjectDir) throw new Error('请先新建或打开一个视频工程')
        }
        try {
          switch (action) {
            case 'run': {
              needProject()
              if (hasLiveTask) throw new Error('已有出片任务在运行，可先暂停或停止')
              if ((directorForm.creationMode || 'ai-coded') === 'ai-coded' && !llmConfig?.configured) {
                return reply(false, { error: '尚未配置 AI 大模型接口：请先在「设置 · 模型与密钥」填入 API Key，或把创作模式切换为「本地极速草稿」', code: 'need-llm' })
              }
              const topic = typeof payload.topic === 'string' ? cleanBriefText(payload.topic) : undefined
              if (topic !== undefined) {
                warTopicRef.current = topic
                setDirectorForm((p) => ({ ...p, topic }))
              }
              const started = await handleStartOneClickPipeline(undefined, { topic: topic !== undefined ? topic : warTopicRef.current })
              if (!started) throw new Error(llmConfig?.configured ? '出片任务未能启动，请查看提示' : '请先配置 AI 大模型接口（已为你打开设置）')
              return reply(true, { data: { runId: started.runId || '' } })
            }
            case 'pause':
            case 'resume':
            case 'stop':
            case 'retry': {
              needProject()
              const runId = currentTaskRun?.id
              if (!runId) throw new Error('当前工程还没有可控制的出片任务')
              const ok = await handleTaskControl(action, runId)
              if (!ok) throw new Error('任务控制指令执行失败')
              return reply(true)
            }
            case 'setDirector':
              applySkinDirectorPatch(payload.patch)
              return reply(true)
            case 'polishTopic': {
              needProject()
              if (!llmConfig?.configured) return reply(false, { error: 'AI 润色需要先配置 AI 大模型接口（设置 · 模型与密钥）', code: 'need-llm' })
              const ok = await handlePolishTopic(typeof payload.topic === 'string' ? payload.topic : warTopicRef.current)
              if (!ok) throw new Error(llmConfig?.configured ? 'AI 润色未完成，请查看提示' : '请先配置 AI 大模型接口（已为你打开设置）')
              return reply(true)
            }
            case 'importFiles': {
              needProject()
              const list = Array.isArray(payload.files) ? payload.files : []
              const files = list
                .filter((f) => f && f.data && typeof f.name === 'string')
                .map((f) => new File([f.data], String(f.name).replace(/[\\/]/g, '_').slice(0, 200) || 'upload.bin', { type: String(f.type || '') }))
              if (!files.length) throw new Error('没有可导入的文件')
              const role = typeof payload.role === 'string' && KIT_ASSET_ROLE_RE.test(payload.role) ? payload.role : ''
              const imported = await handleUploadFiles(files, role)
              if (!imported) throw new Error('素材导入失败，请查看提示')
              return reply(true, { data: { count: imported } })
            }
            case 'removeAsset':
              needProject()
              if (!payload.assetId || !projectAssets.some((a) => a.id === payload.assetId)) throw new Error('素材不存在或已被移除')
              if (!(await handleDeleteAsset(String(payload.assetId)))) throw new Error('移除素材失败')
              return reply(true)
            case 'confirmStaging': {
              needProject()
              const item = stagedCloudAssets.find((x) => x.stagingId === payload.stagingId)
              if (!item) throw new Error('该云端生成结果已不存在')
              if (!(await handleCommitStagedAsset(item))) throw new Error('确认入库失败')
              return reply(true)
            }
            case 'discardStaging':
              needProject()
              if (!payload.stagingId || !stagedCloudAssets.some((x) => x.stagingId === payload.stagingId)) throw new Error('该云端生成结果已不存在')
              if (!(await handleDiscardStagedAsset(String(payload.stagingId)))) throw new Error('丢弃失败')
              return reply(true)
            case 'selectProject': {
              const dir = String(payload.dir || '')
              if (!projects.some((p) => (p.projectDir || p.dir) === dir)) throw new Error('工程不存在或已被删除')
              if (dir !== activeProjectDir) await handleSelectProject(dir)
              return reply(true)
            }
            // Panels are native to the skin now: legacy panel requests are bounced back as an `open-panel` event
            case 'newProject':
              postToSkin({ type: 'dsh-vw/event', event: 'open-panel', data: { panel: 'newProject', args: {} } })
              return reply(true)
            case 'openPanel':
              postToSkin({
                type: 'dsh-vw/event',
                event: 'open-panel',
                data: { panel: String(payload.panel || ''), args: payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {} },
              })
              return reply(true)
            case 'openScene': {
              if (!scenes.some((s) => s.id === payload.sceneId)) throw new Error('该分镜不存在')
              postToSkin({ type: 'dsh-vw/event', event: 'open-panel', data: { panel: 'studio', args: { step: 'scenes', sceneId: String(payload.sceneId) } } })
              return reply(true)
            }
            case 'api':
              return reply(true, { data: await kitApiCall(payload) })
            case 'upload':
              needProject()
              return reply(true, { data: await kitUploadCall(payload) })
            case 'refresh':
              await refreshState(activeProjectDir, { syncForm: Boolean(payload.syncForm) })
              setAssetVersion((v) => v + 1)
              return reply(true)
            case 'setAvatar':
              applySkinAvatarPatch(payload.patch)
              return reply(true)
            case 'createProject': {
              const dir = await handleCreateProject(typeof payload.title === 'string' ? payload.title : '', payload.options)
              if (!dir) throw new Error('新建工程失败，请查看提示')
              return reply(true, { data: { dir } })
            }
            case 'deleteProject': {
              const dir = String(payload.dir || '')
              if (!projects.some((p) => (p.projectDir || p.dir) === dir)) throw new Error('工程不存在或已被删除')
              if (!(await handleDeleteProject(dir))) throw new Error('删除工程失败，请查看提示')
              return reply(true)
            }
            case 'setSkin': {
              const sk = String(payload.skin || '')
              if (!WARROOM_SKINS.some((s) => s.id === sk)) throw new Error(`未知皮肤：${sk}`)
              reply(true)
              changeWarSkin(sk)
              return undefined
            }
            case 'setLowSpec':
              await handleUpdateHardwareMode(payload.on ? 'safe' : 'auto')
              return reply(true)
            case 'backToChat':
              releaseSkinFocus()
              handleBackToChat()
              return reply(true)
            default:
              throw new Error(`不支持的操作：${action || '(空)'}`)
          }
        } catch (err) {
          return reply(false, { error: String(err?.message || err) })
        }
      }
      const warActionRef = useRef(null)
      warActionRef.current = handleWarSkinAction

      // Bridge listener: only messages from OUR skin iframe are accepted
      useEffect(() => {
        const onMessage = (ev) => {
          const frame = warSkinFrameRef.current
          if (!frame || !ev || ev.source !== frame.contentWindow) return
          const msg = ev.data
          if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || msg.type.indexOf('dsh-vw/') !== 0) return
          if (msg.type === 'dsh-vw/ready') {
            setWarSkinPhase('ready')
            flushWarState()
          } else if (msg.type === 'dsh-vw/action') {
            warActionRef.current?.(msg)
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [flushWarState])

      // One-shot cues → skin (toasts incl. translated errors, run start/finish, newly imported assets)
      const warToastSentRef = useRef(0)
      useEffect(() => {
        if (!warSkinReady || !toast || warToastSentRef.current === toast.id) return
        warToastSentRef.current = toast.id
        if (toast.type === 'error') {
          const t = translateBeginnerError(toast.message)
          postToSkin({
            type: 'dsh-vw/event',
            event: 'error',
            data: { title: String(t?.title || toast.message || '操作遇到问题'), detail: String(t?.detail || ''), action: String(t?.action || '') },
          })
          setToast(null)
          return
        }
        postToSkin({ type: 'dsh-vw/event', event: 'toast', data: { text: String(toast.message || ''), level: toast.type === 'success' ? 'success' : 'info' } })
      }, [toast, warSkinReady, postToSkin])
      const warRunTrackRef = useRef({ id: '', status: '' })
      useEffect(() => {
        const prev = warRunTrackRef.current
        const runId = currentTaskRun?.id || ''
        const status = currentTaskRun?.status || ''
        warRunTrackRef.current = { id: runId, status }
        if (!warSkinReady || !runId) return
        const live = (s) => s === 'running' || s === 'queued' || s === 'paused' || s === 'idle'
        if ((runId !== prev.id && live(status)) || (runId === prev.id && !live(prev.status) && live(status))) {
          postToSkin({ type: 'dsh-vw/event', event: 'run-started', data: { runId } })
        } else if (runId === prev.id && live(prev.status) && !live(status)) {
          postToSkin({ type: 'dsh-vw/event', event: 'run-finished', data: { runId, status } })
        }
      }, [currentTaskRun, warSkinReady, postToSkin])
      const warAssetTrackRef = useRef({ dir: '', ids: new Set() })
      useEffect(() => {
        const prev = warAssetTrackRef.current
        const ids = new Set((Array.isArray(projectAssets) ? projectAssets : []).map((a) => a.id))
        warAssetTrackRef.current = { dir: activeProjectDir, ids }
        if (!warSkinReady || prev.dir !== activeProjectDir) return
        const added = [...ids].filter((x) => x && !prev.ids.has(x))
        if (added.length) postToSkin({ type: 'dsh-vw/event', event: 'asset-added', data: { assetIds: added } })
      }, [projectAssets, activeProjectDir, warSkinReady, postToSkin])

      // Non-main shell overlay collapsed pill
      if (!isMainSlot && mainSlotActive) return null
      if (!isMainSlot && mode !== 'video') {
        return h(
          'div',
          { style: { position: 'fixed', top: '10px', right: '180px', zIndex: 2100 } },
          h(
            'button',
            {
              className: 'dsh-vw-btn',
              onClick: () => switchWorkbenchMode('video'),
              style: { ...goldBtnStyle, padding: '7px 16px', fontSize: '13px', borderRadius: '999px' },
            },
            h(Icon, { name: 'film', size: 15 }),
            ' 打开电影视频工坊',
          ),
        )
      }

      const hiddenInputs = h(
        'div',
        { style: { display: 'none' } },
        h('audio', { ref: stageAudioRef, src: masterAudioUrl || undefined, preload: 'auto' }),
        h('audio', { ref: previewAudioRef, onEnded: () => setPlayingVoiceId('') }),
        h('input', {
          ref: fileInputRef,
          type: 'file',
          multiple: true,
          accept: 'image/*,video/*,audio/*,.txt,.md',
          onChange: (ev) => {
            handleUploadFiles(ev.target.files)
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: folderInputRef,
          type: 'file',
          multiple: true,
          webkitdirectory: 'true',
          onChange: (ev) => {
            handleUploadFiles(ev.target.files)
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: bgmInputRef,
          type: 'file',
          accept: 'audio/*,.mp3,.wav,.flac,.m4a,.ogg,.aac',
          onChange: (ev) => {
            if (ev.target.files?.[0]) handleUploadBgmFile(ev.target.files[0])
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: avatarBaseInputRef,
          type: 'file',
          accept: 'video/*,image/*,.mp4,.mov,.webm,.png,.jpg,.jpeg',
          onChange: (ev) => {
            if (ev.target.files?.length) handleUploadFiles(ev.target.files, 'avatar_base')
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: voiceCloneInputRef,
          type: 'file',
          accept: 'audio/*,.mp3,.wav,.flac,.m4a,.ogg',
          onChange: (ev) => {
            if (ev.target.files?.length) handleUploadFiles(ev.target.files, 'voice_clone')
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: cloneFileInputRef,
          type: 'file',
          accept: 'audio/*,.mp3,.wav,.flac,.m4a,.ogg',
          onChange: (ev) => {
            if (ev.target.files?.[0]) handlePickCloneFile(ev.target.files[0])
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: teleImportRef,
          type: 'file',
          accept: 'video/*,audio/*,.mp4,.mov,.webm,.mkv,.wav,.mp3',
          onChange: (ev) => {
            if (ev.target.files?.length) {
              handleUploadFiles(ev.target.files, camTargetRole || 'host_video')
            }
            ev.target.value = ''
          },
        }),
        h('input', {
          ref: refVideoInputRef,
          type: 'file',
          accept: 'video/*,.mp4,.mov,.webm,.mkv,.avi',
          onChange: (ev) => {
            if (ev.target.files?.[0]) handleUploadReferenceVideo(ev.target.files[0])
            ev.target.value = ''
          },
        }),
      )

      // =======================================================================
      // 8. TOP NAVIGATION BAR (COMPACT ZERO-OVERFLOW RESPONSIVE BAR + AI HUB)
      // =======================================================================

      // =======================================================================
      // 9. VIEW 1: KINETIC AI AGENT WAR ROOM (`activeNav === 'warroom'`)
      // =======================================================================


      // =======================================================================
      // 10. VIEW 2: PRECISION STUDIO WORKBENCH (STEPS 01-04)
      // =======================================================================

      // =======================================================================
      // 11. VIEW 3: TASK MONITOR CENTER (`activeNav === 'tasks'`)
      // =======================================================================

      // =======================================================================
      // 12. MODALS: 4-PROTOCOL LLM MODAL, 3-STEP VOICE CLONE LAB, SKIN, VENDOR
      // =======================================================================

      // =======================================================================
      // 13. ROOT WORKBENCH SHELL (CLEAN DUAL-THEME BACKDROP & BEGINNER TOASTS)
      // =======================================================================

      const rootLayout = {
        ...(isMainSlot ? { width: '100%', height: '100%' } : { position: 'fixed', inset: 0, zIndex: 2000 }),
        display: 'flex',
        flexDirection: 'column',
        background: T.bgRoot,
        color: T.textPrimary,
        fontFamily: 'Microsoft YaHei, PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif',
        fontSize: '14px',
        overflow: 'hidden',
      }

      const parsedToastError = toast?.type === 'error' ? translateBeginnerError(toast.message) : null
      // Once the skin is ready it renders every toast (errors arrive as `error` events) and `state.busy` itself;
      // the host only shows them while the skin is still loading or failed to load.
      const showReactToast = Boolean(toast) && !warSkinReady
      const showReactBusy = Boolean(busyLabel) && !warSkinReady
      const skinBg = warSkinMeta?.bg || '#0B0F1A'
      const skinInk = warSkinMeta?.tone === 'light' ? '#3A3A37' : '#C6D2F0'
      const skinSwatch = warSkinMeta?.swatch || '#3BE7FF'

      const warSkinView = warSkinActive
        ? h(
            'div',
            { style: { flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', background: skinBg } },
            warSkinPending
              ? null
              : h('iframe', {
                  key: `${warSkinMeta.id}:${warSkinReloadKey}`,
                  ref: warSkinFrameRef,
                  src: `/api/video-workbench/warroom/skin?id=${encodeURIComponent(warSkinMeta.id)}${warSkinReloadKey ? `&r=${warSkinReloadKey}` : ''}`,
                  title: `AI 作战大屏 · ${warSkinMeta.short} ${warSkinMeta.name}`,
                  // camera / microphone: the native 提词器录制 and 声音克隆 panels record inside the skin
                  allow: 'autoplay; fullscreen; camera; microphone; clipboard-read; clipboard-write',
                  allowFullScreen: true,
                  style: {
                    flex: 1,
                    width: '100%',
                    height: '100%',
                    minWidth: 0,
                    minHeight: 0,
                    border: 0,
                    display: 'block',
                    background: skinBg,
                    opacity: warSkinPhase === 'ready' ? 1 : 0,
                    transition: 'opacity 0.32s ease',
                  },
                }),
            warSkinPhase !== 'ready'
              ? h(
                  'div',
                  {
                    'aria-live': 'polite',
                    style: {
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '10px',
                      pointerEvents: 'none',
                      color: skinInk,
                      fontSize: '13px',
                      fontWeight: 700,
                    },
                  },
                  h('span', { className: 'dsh-vw-rec-dot', style: { width: '8px', height: '8px', borderRadius: '50%', background: skinSwatch } }),
                  `正在载入作战大屏「${warSkinMeta.short} · ${warSkinMeta.name}」…`,
                )
              : null,
          )
        : null

      // The skin failed to load (timeout / not installed): a minimal, skin-neutral recovery screen.
      const recoverBtn = (primary) => ({
        padding: '9px 16px',
        borderRadius: '10px',
        border: `1px solid ${primary ? skinSwatch : 'rgba(148,163,184,0.45)'}`,
        background: primary ? skinSwatch : 'transparent',
        color: primary ? (warSkinMeta?.tone === 'light' ? '#FFFFFF' : '#05070F') : skinInk,
        fontSize: '13px',
        fontWeight: 800,
        cursor: 'pointer',
      })
      const warSkinFailView = !warSkinActive
        ? h(
            'div',
            { role: 'alert', style: { flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: skinBg } },
            h(
              'div',
              { style: { width: '100%', maxWidth: '540px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px', color: skinInk, textAlign: 'center' } },
              h('div', { style: { width: '42px', height: '42px', borderRadius: '50%', border: `2px solid ${skinSwatch}`, display: 'grid', placeItems: 'center', fontSize: '20px', fontWeight: 900, color: skinSwatch } }, '!'),
              h(
                'div',
                { style: { fontSize: '18px', fontWeight: 800, lineHeight: 1.5 } },
                `作战大屏「${warSkinMeta ? `${warSkinMeta.short} · ${warSkinMeta.name}` : warSkin}」${warSkinAvailable ? '加载超时' : '尚未安装'}`,
              ),
              h(
                'div',
                { style: { fontSize: '13px', lineHeight: 1.75, opacity: 0.82 } },
                warSkinAvailable
                  ? '大屏在 9 秒内没有响应（电脑繁忙或页面脚本出错时会出现）。请点「重新载入」，或先切换到另一套大屏继续创作。'
                  : '插件里缺少这套大屏的文件，请更新或重新安装插件；也可以先切换到另一套大屏继续创作。',
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' } },
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () => {
                      refreshWarSkinCatalog()
                      setWarSkinPhase('loading')
                      setWarSkinReloadKey((k) => k + 1)
                    },
                    style: recoverBtn(true),
                  },
                  '重新载入',
                ),
                ...WARROOM_SKINS.filter((sk) => sk.id !== warSkin).map((sk) =>
                  h('button', { key: sk.id, type: 'button', onClick: () => changeWarSkin(sk.id), style: recoverBtn(false) }, `改用 ${sk.short} · ${sk.name}`),
                ),
              ),
            ),
          )
        : null

      return h(
        'div',
        { className: 'dsh-vw-root', style: rootLayout },
        hiddenInputs,
        h(
          'div',
          { style: { position: 'relative', zIndex: 2, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
          warSkinActive ? warSkinView : warSkinFailView,
        ),
        // While the skin is still loading: host busy pill + toast (the ready skin renders both natively)
        showReactBusy
          ? h(
              'div',
              { style: { position: 'fixed', bottom: '26px', left: '50%', transform: 'translateX(-50%)', zIndex: 3500, padding: '13px 22px', borderRadius: '999px', background: T.bgPanelSolid, border: `1.5px solid ${T.accentBlueBorder}`, boxShadow: T.shadowPopover, display: 'flex', alignItems: 'center', gap: '12px', minWidth: '300px', maxWidth: '88vw' } },
              h('span', { className: 'dsh-vw-rec-dot', style: { width: '10px', height: '10px', borderRadius: '50%', background: T.accentBlue, flexShrink: 0 } }),
              h('span', { style: { fontSize: '13.5px', fontWeight: 700, flex: 1 } }, busyLabel),
              busyProgress > 0 ? h('span', { style: { fontSize: '13px', fontFamily: 'Consolas, monospace', color: T.accentBlue, fontWeight: 800 } }, `${Math.round(busyProgress)}%`) : null,
            )
          : null,
        showReactToast
          ? h(
              'div',
              {
                className: 'dsh-vw-popover-in',
                style: {
                  position: 'fixed',
                  bottom: '26px',
                  right: '26px',
                  zIndex: 3600,
                  maxWidth: '460px',
                  padding: '13px 18px',
                  borderRadius: '13px',
                  background: T.bgPanelSolid,
                  border: `1.5px solid ${toast.type === 'error' ? T.accentRed : toast.type === 'success' ? T.accentGreen : T.accentBlue}`,
                  boxShadow: T.shadowPopover,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                },
              },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px' } },
                h('span', { style: { fontSize: '13.5px', fontWeight: 700, color: toast.type === 'error' ? T.accentRed : toast.type === 'success' ? T.accentGreen : T.textPrimary, lineHeight: 1.5 } }, parsedToastError ? parsedToastError.title : toast.message),
                h('button', { type: 'button', onClick: () => setToast(null), style: { background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', flexShrink: 0 } }, h(Icon, { name: 'x', size: 15 })),
              ),
              parsedToastError?.detail
                ? h('button', { type: 'button', onClick: () => setShowRawError((v) => !v), style: { alignSelf: 'flex-start', background: 'transparent', border: 'none', color: T.textMuted, fontSize: '12px', cursor: 'pointer', textDecoration: 'underline' } }, showRawError ? '收起技术细节' : '查看技术细节')
                : null,
              showRawError && parsedToastError?.detail
                ? h('pre', { style: { margin: 0, padding: '8px', borderRadius: '8px', background: T.bgInput, fontSize: '12px', whiteSpace: 'pre-wrap', color: T.textMuted, maxHeight: '110px', overflowY: 'auto' } }, parsedToastError.detail)
                : null,
            )
          : null,
      )
    }

    // DSH Tool Call Inline Progress / Preview Card
    function VideoToolCallCard(props) {
      const name = props?.toolName || props?.name || props?.toolCall?.name || '视频工坊工具'
      const status = props?.status || props?.toolCall?.status || 'completed'
      const rawOut = props?.output || props?.result || props?.toolCall?.output
      let summary = ''
      try {
        const parsed = typeof rawOut === 'string' ? JSON.parse(rawOut) : rawOut
        if (parsed && typeof parsed === 'object') {
          summary = parsed.message || parsed.mp4Path || parsed.relPath || parsed.projectDir || ''
        }
      } catch {
        if (typeof rawOut === 'string') summary = rawOut.slice(0, 140)
      }
      return h(
        'div',
        {
          style: {
            padding: '12px 15px',
            borderRadius: '12px',
            background: 'rgba(13, 18, 30, 0.85)',
            border: '1px solid rgba(34, 211, 238, 0.35)',
            color: '#F1F5F9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            fontFamily: '"Noto Sans SC", system-ui, sans-serif',
          },
        },
        h(
          'div',
          { style: { minWidth: 0 } },
          h('div', { style: { fontSize: '13.5px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '7px' } }, h(Icon, { name: 'film', size: 15, color: '#22D3EE' }), name),
          summary ? h('div', { style: { fontSize: '12.5px', color: '#94A3B8', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, summary) : null,
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
          h('span', { style: { fontSize: '12px', color: status === 'error' ? '#FB7185' : '#34D399', fontWeight: 700 } }, status === 'running' ? '执行中' : status === 'error' ? '异常' : '完成'),
          h(
            'button',
            {
              type: 'button',
              onClick: () => window.dispatchEvent(new CustomEvent('dsh-video:switch-mode', { detail: { mode: 'video' } })),
              style: { padding: '6px 12px', borderRadius: '8px', border: '1px solid rgba(245,185,66,0.45)', background: 'rgba(245,185,66,0.14)', color: '#F5B942', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer' },
            },
            '进工坊查看',
          ),
        ),
      )
    }

    function MainVideoWorkbenchPanel() {
      return h(PanelBoundary, null, h(VideoWorkbenchApp, { isMainSlot: true, layoutService: hostLayoutSvc }))
    }

    function ToolViewCard(props) {
      return h(PanelBoundary, null, h(VideoToolCallCard, props))
    }

    return {
      name: 'dsh-video-workbench',
      inject: ['slots'],
      apply(ctx) {
        try {
          if (typeof ctx?.get === 'function') {
            const initialLayout = ctx.get('layout')
            if (initialLayout) attachHostLayout(initialLayout)
          }
        } catch {}
        if (typeof ctx?.inject === 'function') {
          try {
            ctx.inject(['layout'], (scoped) => attachHostLayout(scoped?.layout))
          } catch {}
        }
        if (typeof ctx?.slots?.inject === 'function') {
          ctx.slots.inject('main', () =>
            ctx.slots.register(
              { name: 'main', key: 'video-workbench', label: 'AI 视频工坊' },
              MainVideoWorkbenchPanel,
            ),
          )
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: 'video-workbench', label: 'AI 视频工坊', order: 65 },
              SidebarVideoIcon,
            ),
          )
          const videoToolKeys = [
            'produce_video',
            'plan_video_from_assets',
            'ai_create_video',
            'ai_refine_scene',
            'run_agent_pipeline',
            'video_render',
            'generate_avatar',
            'generate_speech',
          ]
          for (const toolKey of videoToolKeys) {
            ctx.slots.inject('tool.call.toolview', () =>
              ctx.slots.register(
                { name: 'tool.call.toolview', key: toolKey },
                (props) => h(ToolViewCard, { toolName: toolKey, ...(props || {}) }),
              ),
            )
          }
        } else {
          ctx.slots.register('sidebar.panellist', {
            id: 'video-workbench',
            label: 'AI 视频工坊',
            order: 65,
            render: () => h(SidebarVideoIcon),
          })
          ctx.slots.register('main', {
            key: 'video-workbench',
            render: () => h(MainVideoWorkbenchPanel),
          })
          ctx.slots.register('tool.call.toolview', {
            id: 'video-workbench-toolview',
            order: 25,
            render: (props) => h(ToolViewCard, props),
          })
        }
      },
    }
  },
})
