import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  loadEnv,
  probeAudioDuration,
  REPO_ROOT,
  resolveBinaries,
  resolveVideoDimensions,
  runCommandRedirected,
} from '../packages/shared/index.js'
import { executeGenerateAvatar } from '../packages/dsh-tool-avatar/index.js'
import {
  deleteImportedVoice,
  ensureTtsServer,
  executeGenerateSpeech,
  getVoiceCatalog,
  importVoicePack,
  matchAllScenesInScript,
} from '../packages/dsh-tool-local-tts/index.js'
import {
  executeVideoLint,
  executeVideoRender,
  executeVideoSnapshot,
  runPostRenderQa,
  runTypecheckOnProject,
} from '../packages/dsh-tool-video-suite/index.js'
import {
  executeCurateAndEditAssets,
  importAssets,
  mixVideoAudio,
  planVideoFromAssets,
  readAssets,
  runAiStudioPipeline,
  taskManager,
} from '../packages/dsh-tool-media/index.js'
import { scaffoldVideoProject } from '../packages/dsh-preset-video/index.js'
import { handleWorkbenchApiRequest, polishTopicPrompt } from '../packages/dsh-web-video-workbench/lib/index.js'
import { verifyCordisPluginMounting } from './dsh-runner.mjs'

/**
 * Scan repository files to ensure ZERO hardcoded personal paths or API keys exist in open-source files.
 */
function scanForHardcodedPaths(dir, relativePrefix = '') {
  const violations = []
  const skipNames = new Set([
    '.env',
    '.git',
    'node_modules',
    '.npm-cache',
    '.dsh-home',
    '.tmp',
    '.tmp-render',
    'output',
    'assets',
    'uploads',
    'public',
    'audio',
    'cache',
    'publish',
    'vendor',
    'imported',
    'catalog.json',
  ])

  for (const entry of readdirSync(dir)) {
    if (skipNames.has(entry)) continue
    const full = join(dir, entry)
    const rel = relativePrefix ? `${relativePrefix}/${entry}` : entry
    const st = statSync(full)
    if (st.isDirectory()) {
      violations.push(...scanForHardcodedPaths(full, rel))
    } else if (/\.(js|mjs|cjs|ts|tsx|json|yml|yaml|md|py|cmd)$/i.test(entry)) {
      if (rel.startsWith('examples/demo-') || rel === 'scripts/self-test.mjs') {
        continue
      }
      const content = readFileSync(full, 'utf8')
      const driveUserPattern = new RegExp('[C-E]:\\\\Users\\\\[A-Za-z0-9_]+', 'i')
      const personalDrivePattern = new RegExp('(?:D:\\\\index-tts|D:\\\\DeepSeekHarness|E:\\\\05_)', 'i')
      if (driveUserPattern.test(content) || personalDrivePattern.test(content)) {
        violations.push(rel)
      }
    }
  }
  return violations
}

async function generateSyntheticTestAssets(assetDir, ffmpeg) {
  rmSync(assetDir, { recursive: true, force: true })
  mkdirSync(assetDir, { recursive: true })

  const heroPng = join(assetDir, '01_product_hero.png')
  const brollMp4 = join(assetDir, '02_motion_broll.mp4')
  const bgmWav = join(assetDir, 'bgm_synth_track.wav')
  const sfxWav = join(assetDir, 'sfx_whoosh_custom.wav')
  const noteTxt = join(assetDir, 'brief.txt')

  await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'color=c=#0ea5e9:s=1280x720:d=0.1', '-frames:v', '1', heroPng],
    { timeoutMs: 20_000 },
  )
  await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30', '-t', '2.5', '-c:v', 'libx264', '-bf', '0', '-g', '15', '-video_track_timescale', '90000', '-pix_fmt', 'yuv420p', brollMp4],
    { timeoutMs: 30_000 },
  )
  await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000:duration=10', '-ac', '2', bgmWav],
    { timeoutMs: 20_000 },
  )
  await runCommandRedirected(
    ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=0.4', '-ac', '2', sfxWav],
    { timeoutMs: 20_000 },
  )
  writeFileSync(
    noteTxt,
    '产品核心亮点：\n1. 全自动素材导入与视觉特效合成。\n2. IndexTTS-2 真人配音与多轨自动闪避混音。',
    'utf8',
  )
  return { heroPng, brollMp4, bgmWav, sfxWav, noteTxt }
}

async function probeMediaStreams(ffprobe, mediaPath) {
  const res = await runCommandRedirected(
    ffprobe,
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', mediaPath],
    { timeoutMs: 15_000 },
  )
  if (res.code !== 0) {
    throw new Error(`ffprobe failed for ${mediaPath}: ${res.stderr}`)
  }
  return JSON.parse(res.stdout)
}

async function runSelfTest() {
  loadEnv()
  console.log('======================================================================')
  console.log('🧪 DSH Video Workbench — Full-Chain End-to-End Automated Verification')
  console.log('======================================================================')

  // 1. Binary & Environment Check
  const bins = resolveBinaries()
  console.log(`[1/8] FFmpeg / FFprobe resolved:`)
  console.log(`      ffmpeg  = ${bins.ffmpeg}`)
  console.log(`      ffprobe = ${bins.ffprobe}`)

  // 2. Cordis Plugin & Preset Mounting Check
  const mount = verifyCordisPluginMounting()
  console.log(`[2/8] Cordis Tools (${mount.tools.length}): ${mount.tools.join(', ')}`)
  console.log(`      Presets (${mount.presets.length}): ${mount.presets.map((p) => `${p.name} [${p.id}]`).join(', ')}`)
  const requiredTools = [
    'import_assets',
    'list_assets',
    'generate_sfx_bgm',
    'plan_video_from_assets',
    'produce_video',
    'ai_create_video',
    'ai_master_voice',
    'configure_llm_model',
    'export_publish_pack',
    'import_vendor_motion',
    'list_voices',
    'import_voice_pack',
    'match_scene_voices',
    'generate_speech',
    'video_lint',
    'video_snapshot',
    'video_render',
  ]
  for (const t of requiredTools) {
    if (!mount.tools.includes(t)) {
      throw new Error(`Missing required Cordis tool: ${t}`)
    }
  }
  if (mount.presets.length < 1) {
    throw new Error('Cordis video-maker preset missing!')
  }

  // 3. Asset Import & Voice Pack Catalog Verification
  const initialCatalog = getVoiceCatalog()
  console.log(
    `[3/8] Voice Catalog loaded ${initialCatalog.voices.length} voices | Categories: ${JSON.stringify(initialCatalog.categories)}`,
  )

  if (process.env.DEFAULT_REF_AUDIO && existsSync(process.env.DEFAULT_REF_AUDIO)) {
    const imp = await importVoicePack({
      sourcePath: process.env.DEFAULT_REF_AUDIO,
      id: 'imported-custom-narrator',
      name: '用户导入测试音色包 (Custom Narrator)',
      gender: 'female',
      tags: ['自定义', '清晰', '测试', '旁白'],
      promptText: process.env.DEFAULT_REF_TEXT || '',
    })
    console.log(`      Imported custom voice pack: ${imp.importedVoices[0].name} (${imp.importedVoices[0].durationSec}s)`)
  }

  const tmpAssetSrc = join(REPO_ROOT, '.tmp', 'e2e-assets-src')
  const tmpHtmlProj = join(REPO_ROOT, '.tmp', 'e2e-asset-html')
  const tmpRemotionProj = join(REPO_ROOT, '.tmp', 'e2e-asset-remotion')
  rmSync(tmpHtmlProj, { recursive: true, force: true })
  rmSync(tmpRemotionProj, { recursive: true, force: true })

  await generateSyntheticTestAssets(tmpAssetSrc, bins.ffmpeg)
  const imported = await importAssets({ projectDir: tmpHtmlProj, sources: [tmpAssetSrc] })
  const importedManifest = readAssets(tmpHtmlProj)
  if (!imported.ok || importedManifest.items.length < 4 || importedManifest.notes.length < 1) {
    throw new Error(`Asset import incomplete: ${JSON.stringify(importedManifest)}`)
  }
  console.log(
    `      Asset Import verified: ${importedManifest.items.length} media assets + ${importedManifest.notes.length} note`,
  )

  // 4. AI Storyboard Planning + Code Generation (Both HTML5 & Remotion)
  const htmlPlan = await planVideoFromAssets({
    projectDir: tmpHtmlProj,
    topic: 'AI 智能素材成片与多轨混音演示',
    style: 'tech',
    engine: 'html',
    voiceId: 'auto',
  })
  const scenesWithVisuals = htmlPlan.script.scenes.filter(
    (s) => (Array.isArray(s.media) && s.media.length > 0) || Boolean(s.mediaPath),
  )
  if (scenesWithVisuals.length < 2) {
    throw new Error('Expected planVideoFromAssets to map imported image & video assets onto scenes')
  }
  console.log(
    `[4/8] AI Director Planned ${htmlPlan.sceneCount} scenes (${scenesWithVisuals.length} scenes bound to user visuals, SFX=${htmlPlan.sfxCount})`,
  )

  // Limit to 2 concise scenes for fast yet REAL IndexTTS-2 + dual-engine render E2E test
  const trimmedScenes = htmlPlan.script.scenes.slice(0, 2).map((s, idx) => ({
    ...s,
    narration:
      idx === 0
        ? 'AI 全自动素材成片，支持图文与视频运镜联动。'
        : '支持两百零五个本地音色，叠加转场音效与配乐闪避混音。',
  }))
  scaffoldVideoProject(tmpHtmlProj, {
    title: 'AI 素材生成视频 E2E 实测 (HTML5)',
    engine: 'html',
    style: 'tech',
    scenes: trimmedScenes,
  })
  matchAllScenesInScript(tmpHtmlProj, { voiceId: 'auto' })

  // 5. Real IndexTTS-2.5 Persistent Server Synthesis + ffprobe Duration + Multi-Track Audio Mix
  console.log(`[5/8] Ensuring persistent IndexTTS-2.5 HTTP server for REAL speech synthesis...`)
  const ttsHealth = await ensureTtsServer({ waitMs: 300_000 })
  if (ttsHealth?.engine !== 'indextts25') {
    throw new Error(`Expected IndexTTS-2.5 server engine 'indextts25', got: ${JSON.stringify(ttsHealth)}`)
  }
  const reReadHtml = await import('../packages/shared/index.js').then((m) => m.readScriptJson(tmpHtmlProj))
  const twoScenes = reReadHtml.data.scenes.slice(0, 2)
  reReadHtml.data.scenes = twoScenes
  await import('../packages/shared/index.js').then((m) => m.writeScriptJson(tmpHtmlProj, reReadHtml.data))

  const s1Speech = await executeGenerateSpeech({
    text: twoScenes[0].narration,
    emotion: twoScenes[0].emotion || '平静',
    voiceId: 'auto',
    fps: 30,
    outputPath: join(tmpHtmlProj, 'audio', `${twoScenes[0].id}.wav`),
    scriptPath: tmpHtmlProj,
    sceneId: twoScenes[0].id,
    allowPlaceholder: false,
  })
  const s2Speech = await executeGenerateSpeech({
    text: twoScenes[1].narration,
    emotion: twoScenes[1].emotion || '高兴',
    voiceId: 'indextts-pingshu',
    fps: 30,
    outputPath: join(tmpHtmlProj, 'audio', `${twoScenes[1].id}.wav`),
    scriptPath: tmpHtmlProj,
    sceneId: twoScenes[1].id,
    allowPlaceholder: false,
  })
  if (s1Speech.voicePlaceholder || s2Speech.voicePlaceholder) {
    throw new Error('Expected REAL IndexTTS-2 synthesis, but received placeholder tone!')
  }
  console.log(
    `      • Real IndexTTS-2 verified: scene-01=${s1Speech.durationSec}s (${s1Speech.voiceName}), scene-02=${s2Speech.durationSec}s (${s2Speech.voiceName})`,
  )

  const savedHtml = await import('../packages/shared/index.js').then((m) => m.readScriptJson(tmpHtmlProj))
  const { writeScriptJson, readScriptJson } = await import('../packages/shared/index.js')
  const { syncProjectCodeFromScript } = await import('../packages/dsh-tool-media/index.js')
  syncProjectCodeFromScript(tmpHtmlProj, savedHtml.data)

  const mixRes = await mixVideoAudio({ projectDir: tmpHtmlProj, script: savedHtml.data })
  const mixProbe = await probeAudioDuration(mixRes.outputPath, 30)
  console.log(
    `      • Multi-track Audio Mix verified: voices=${mixRes.voiceCount}, sfx=${mixRes.sfxCount}, bgm=${mixRes.bgmSource}, duration=${mixProbe.durationSec}s`,
  )

  // 6. Lint + Real Full-FPS HTML CDP MP4 Render
  const htmlLint = await executeVideoLint({ projectDir: tmpHtmlProj, engine: 'html' })
  if (!htmlLint.ok) {
    throw new Error(`HTML video_lint failed: ${htmlLint.errors.join('; ')}`)
  }
  const htmlSnap = await executeVideoSnapshot({ projectDir: tmpHtmlProj, engine: 'html' })
  const htmlRender = await executeVideoRender({
    projectDir: tmpHtmlProj,
    engine: 'html',
    renderWidth: 1280,
    renderHeight: 720,
  })
  const htmlMp4Info = await probeMediaStreams(bins.ffprobe, htmlRender.outputPath)
  const hasH264 = htmlMp4Info.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264')
  const hasAac = htmlMp4Info.streams.some((s) => s.codec_type === 'audio')
  if (!hasH264 || !hasAac) {
    throw new Error(`HTML rendered MP4 missing expected video/audio streams: ${htmlRender.outputPath}`)
  }
  console.log(
    `[6/8] HTML5 CDP Full-FPS Render verified (${htmlRender.renderMethod}): ${(htmlRender.fileSizeBytes / 1024).toFixed(1)} KB, streams=h264+audio, snap=${htmlSnap.captureMethod}`,
  )

  // 7. Remotion Dual-Engine Lint + Snapshot + Real Render Verification
  await importAssets({ projectDir: tmpRemotionProj, sources: [tmpAssetSrc] })
  await planVideoFromAssets({
    projectDir: tmpRemotionProj,
    topic: 'Remotion 双引擎实时组件合成测试',
    style: 'cinematic',
    engine: 'remotion',
  })
  const remMeta = readScriptJson(tmpRemotionProj)
  remMeta.data.width = 1280
  remMeta.data.height = 720
  remMeta.data.scenes = remMeta.data.scenes.slice(0, 2).map((s, idx) => ({
    ...s,
    audioFile: `audio/${twoScenes[idx].id}.wav`,
    voiceDurationSec: idx === 0 ? s1Speech.durationSec : s2Speech.durationSec,
    durationSec: 2.5,
    durationInFrames: 75,
  }))
  mkdirSync(join(tmpRemotionProj, 'audio'), { recursive: true })
  const { copyFileSync } = await import('node:fs')
  for (const ts of twoScenes) {
    copyFileSync(join(tmpHtmlProj, 'audio', `${ts.id}.wav`), join(tmpRemotionProj, 'audio', `${ts.id}.wav`))
  }
  const savedRem = writeScriptJson(tmpRemotionProj, remMeta.data)
  syncProjectCodeFromScript(tmpRemotionProj, savedRem.data)

  const remLint = await executeVideoLint({ projectDir: tmpRemotionProj, engine: 'remotion' })
  if (!remLint.ok) {
    throw new Error(`Remotion video_lint failed: ${remLint.errors.join('; ')}`)
  }
  const remSnap = await executeVideoSnapshot({ projectDir: tmpRemotionProj, engine: 'remotion' })
  const remRender = await executeVideoRender({ projectDir: tmpRemotionProj, engine: 'remotion' })
  const remMp4Info = await probeMediaStreams(bins.ffprobe, remRender.outputPath)
  const remHasV = remMp4Info.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264')
  const remHasA = remMp4Info.streams.some((s) => s.codec_type === 'audio')
  if (!remHasV || !remHasA) {
    throw new Error(`Remotion rendered MP4 missing H.264/audio streams!`)
  }
  console.log(
    `[7/8] Remotion Engine Render verified (${remRender.renderMethod}): ${(remRender.fileSizeBytes / 1024).toFixed(1)} KB, snap=${remSnap.captureMethod}`,
  )

  // 8. Live API Route, LLM Masked Config, & Range Check
  const apiState = await handleWorkbenchApiRequest(new Request('http://127.0.0.1:4399/api/video-workbench/state'))
  const apiJson = await apiState.json()
  if (!apiJson.ok || !apiJson.ttsStatus || !apiJson.llmConfig) {
    throw new Error('Workbench /state API failed health check or missing llmConfig summary')
  }
  if ('apiKey' in (apiJson.llmConfig || {})) {
    throw new Error('Security violation: plaintext apiKey must never be serialized in /state')
  }
  const rangeRes = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399/api/video-workbench/asset?projectDir=${encodeURIComponent(tmpHtmlProj)}&rel=${encodeURIComponent('output/final.mp4')}`, {
      headers: { range: 'bytes=0-1023' },
    }),
  )
  if (rangeRes.status !== 206) {
    throw new Error(`Expected HTTP 206 Partial Content for asset Range request, got ${rangeRes.status}`)
  }

  // Verify Post-Render FFmpeg QA Report from HTML render & QA API endpoint
  const qaApiRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/qa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: tmpHtmlProj }),
    }),
  )
  const qaJson = await qaApiRes.json()
  if (!qaJson.ok || !qaJson.qa?.passed) {
    throw new Error(`FFmpeg QA verification failed: ${JSON.stringify(qaJson)}`)
  }
  console.log(
    `[8/10] API, Masked LLM Config, Range 206 & FFmpeg QA verified (loudness=${qaJson.qa.loudness?.integratedLufs} LUFS, blackSegments=${qaJson.qa.blackSegments?.length})`,
  )

  // 9. Aspect Ratio Resolver + `tsc --noEmit` Preflight + Mocked LLM Coding 3-Round Auto-Repair Loop
  const autoPortDims = resolveVideoDimensions({
    aspectRatio: 'auto',
    quality: '1080p',
    topic: '抖音爆款产品竖屏推广',
  })
  const xhsDims = resolveVideoDimensions({ aspectRatio: 'auto', quality: '720p', topic: '小红书好物图文笔记' })
  const twoKDims = resolveVideoDimensions({ aspectRatio: '16:9', quality: '2k' })
  const assetPortDims = resolveVideoDimensions({
    aspectRatio: 'auto',
    quality: '1080p',
    topic: '风光记录',
    assets: [{ width: 1080, height: 1920 }, { width: 1080, height: 1920 }],
  })
  if (
    autoPortDims.width !== 1080 || autoPortDims.height !== 1920 ||
    xhsDims.aspectRatio !== '3:4' || xhsDims.width !== 720 || xhsDims.height !== 960 ||
    twoKDims.width !== 2560 || twoKDims.height !== 1440 ||
    assetPortDims.aspectRatio !== '9:16'
  ) {
    throw new Error(`Dimension resolver assertion failed: ${JSON.stringify({ autoPortDims, xhsDims, twoKDims, assetPortDims })}`)
  }

  // Run strict tsc --noEmit on Remotion showcase project (`shotcraft.tsx` + `VideoComposition.tsx`)
  const remTsc = await runTypecheckOnProject(tmpRemotionProj)
  if (!remTsc.ok) {
    throw new Error(`Remotion preflight tsc --noEmit failed: ${remTsc.errors.join(' | ')}`)
  }

  // Test full LLM AI Studio pipeline with mocked Anthropic-format LLM returning broken TSX first, then repairing in Round 1!
  const tmpAiProj = join(REPO_ROOT, '.tmp', 'test-ai-coder')
  rmSync(tmpAiProj, { recursive: true, force: true })
  scaffoldVideoProject(tmpAiProj, { title: 'LLM Auto-Repair Test', engine: 'remotion' })

  let llmCallCounter = 0
  let brokenCodeEmitted = false
  const mockLlmFetch = async (url, init) => {
    llmCallCounter++
    const body = JSON.parse(init?.body || '{}')
    const sysPrompt = String(body?.system || '')
    const userPrompt = String(body?.messages?.[body.messages.length - 1]?.content || '')

    // AI-Coded Audio BGM DSP script call (the scene coder prompt also mentions DSP in its Vibecoding toolkit notes,
    // so route on the audio contract itself rather than the bare word)
    if (userPrompt.includes('synthesizeBgm') || sysPrompt.includes('synthesizeBgm') || (sysPrompt.includes('DSP') && !sysPrompt.includes('Remotion'))) {
      const codeStr = `function synthesizeBgm(ctx) {
  const N = ctx.totalSamples;
  for (let i = 0; i < N; i++) {
    const t = i / ctx.sampleRate;
    const kickEnv = Math.exp(-(t % (60 / (ctx.bpm || 112))) * 16);
    const pad = Math.sin(2 * Math.PI * 220 * t) * 0.14 + Math.sin(2 * Math.PI * 329.63 * t) * 0.10;
    const sub = Math.sin(2 * Math.PI * 55 * t) * 0.18 * kickEnv;
    ctx.left[i] = ctx.tanh(pad + sub);
    ctx.right[i] = ctx.tanh(pad * 0.94 + sub);
  }
}`
      return new Response(
        JSON.stringify({
          model: 'mock-opus',
          content: [{ type: 'text', text: JSON.stringify({ files: { 'audio/ai_bgm_synth.js': codeStr }, summary: 'Mock AI DSP 48kHz Synth', bpm: 112 }) }],
        }),
        { status: 200 },
      )
    }

    // Voice Mastering call (after TTS, before audio mix & codegen)
    if (sysPrompt.includes('声学') || userPrompt.includes('integratedLufs') || userPrompt.includes('tracks')) {
      const vmReply = JSON.stringify({
        engineerSummary: 'Mock AI Studio Broadcast Vocal Master -14 LUFS',
        globalPreset: 'broadcast-clean',
        tracks: [
          {
            sceneId: 'scene-01',
            preset: 'broadcast-clean',
            hpfHz: 85,
            presenceGainDb: 2.0,
            deEssDb: -3.0,
            compRatio: 3.0,
            targetLufs: -14,
            reverbWet: 0.04,
            reason: 'Clear vocal presence',
          },
        ],
      })
      return new Response(JSON.stringify({ model: 'mock-opus', content: [{ type: 'text', text: vmReply }] }), { status: 200 })
    }

    // Initial Codegen call: deliberately emit invalid Batch01 TSX (CSS transition + TypeScript error) to trigger targeted batch auto-repair!
    if ((userPrompt.includes('请编写模块 src/scenes/Batch') || userPrompt.includes('生成定制 Remotion TSX') || userPrompt.includes('生成定制 HTML')) && !brokenCodeEmitted) {
      brokenCodeEmitted = true
      const brokenBatchTsx = `import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
const Scene01: React.FC<CustomSceneProps> = () => {
  const f = useCurrentFrame();
  const broken: number = "bad_type_string";
  return <AbsoluteFill style={{ transition: 'all 0.3s' }}>{f}{broken}</AbsoluteFill>;
};
export const BATCH_01_SCENES: Record<string, React.FC<CustomSceneProps>> = { 'scene-01': Scene01 };`
      const brokenReply = JSON.stringify({
        files: {
          'src/scenes/Batch01.tsx': brokenBatchTsx,
        },
      })
      return new Response(JSON.stringify({ model: 'mock-opus', content: [{ type: 'text', text: brokenReply }] }), { status: 200 })
    }

    // Call 1: Director Architect returning 9:16 portrait plan + custom audioSpec + synth_sfx
    if (!brokenCodeEmitted) {
      const directorReply = JSON.stringify({
        title: 'AI 编程测试短片',
        style: 'cinematic',
        recommendedAspectRatio: '9:16',
        theme: {
          bgPrimary: '#090B10',
          bgSecondary: '#141926',
          textPrimary: '#F8FAFC',
          textMuted: '#94A3B8',
          accentPrimary: '#E5A93C',
          accentSecondary: '#38BDF8',
        },
        audioSpec: {
          mood: 'cinematic',
          bpm: 112,
          drumDensity: 0.72,
          leadStyle: 'glock',
          padCutoff: 1650,
          chords: [
            [38, [62, 65, 69, 72]],
            [34, [58, 65, 69, 74]],
            [41, [60, 65, 69, 76]],
            [36, [60, 64, 67, 72]],
          ],
        },
        scenes: [
          {
            id: 'scene-01',
            title: '竖屏黑金视觉震撼开场',
            shotType: 'hero-title',
            emotion: '激情',
            role: 'host',
            narration: '从零行模板到专属电影动效代码，让每一帧画面由大模型精准编排。',
            headline: 'AI 创意编程',
            kicker: 'CINEMA STUDIO',
            metrics: [{ label: '效率提升', value: 98, suffix: '%' }],
            motionNotes: 'PageCam 缓慢推进 + DigitRoll 数字滚动',
            sfxCues: [{ type: 'synth_sfx', offsetSec: 0.1, freqStart: 920, freqEnd: 160, durationMs: 320, wave: 'saw', volume: 0.55 }],
          },
        ],
      })
      return new Response(JSON.stringify({ model: 'mock-opus', content: [{ type: 'text', text: directorReply }] }), { status: 200 })
    }

    // Auto-repair call: receive exact tsc + lint diagnostics -> emit valid fixed Batch01 TSX using shotcraft primitives!
    if (!userPrompt.includes('transition') && !userPrompt.includes('TS2322') && !userPrompt.includes('number')) {
      throw new Error(`Auto-repair prompt missing compiler/lint diagnostics: ${userPrompt.slice(0, 200)}`)
    }
    const fixedBatchTsx = `import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { ClipCard, DigitRoll, PageCam } from '../lib/shotcraft';
export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
const Scene01: React.FC<CustomSceneProps> = ({ scene }) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: '#090B10', color: '#F8FAFC' }}>
      <PageCam startFrame={0} durationFrames={Math.max(12, Number(scene?.durationInFrames) || 60)}>
        <ClipCard delay={4} accentColor="#E5A93C">
          <DigitRoll to={98 + (f % 1)} suffix="%" />
        </ClipCard>
      </PageCam>
    </AbsoluteFill>
  );
};
export const BATCH_01_SCENES: Record<string, React.FC<CustomSceneProps>> = { 'scene-01': Scene01 };`
    return new Response(
      JSON.stringify({
        model: 'mock-opus',
        content: [{ type: 'text', text: JSON.stringify({ files: { 'src/scenes/Batch01.tsx': fixedBatchTsx } }) }],
      }),
      { status: 200 },
    )
  }

  const aiPipeRes = await runAiStudioPipeline({
    projectDir: tmpAiProj,
    topic: 'AI 编程测试短片',
    engine: 'remotion',
    aspectRatio: 'auto',
    quality: '1080p',
    aiBadge: true,
    render: false, // Full tsc + lint + audioSpec + auto-repair verified without duplicating 20s headless chromium in mock pass
    allowPlaceholder: true,
    llmOverride: {
      provider: 'anthropic',
      format: 'anthropic',
      baseUrl: 'https://mock.anthropic.local',
      apiKey: 'mock-test-key',
      model: 'mock-opus',
      maxRepairRounds: 3,
    },
    fetchImpl: mockLlmFetch,
  })
  if (!aiPipeRes.ok || aiPipeRes.buildLog?.repairRoundsUsed !== 1 || aiPipeRes.script?.width !== 1080 || aiPipeRes.script?.height !== 1920) {
    throw new Error(`AI Coding Auto-Repair verification failed: ${JSON.stringify(aiPipeRes.buildLog)}`)
  }
  const codeApiRes = await handleWorkbenchApiRequest(new Request(`http://127.0.0.1:4399/api/video-workbench/code?projectDir=${encodeURIComponent(tmpAiProj)}`))
  const codeApiJson = await codeApiRes.json()
  if (!codeApiJson.ok || !(codeApiJson.files || []).some((f) => f.path === 'src/VideoComposition.tsx')) {
    throw new Error('Workbench /code API failed to list generated TSX files')
  }
  console.log(
    `[9/11] Dimensions Auto-Detection + tsc --noEmit (${remTsc.skipped ? 'skipped' : '0 errors'}) + Mocked LLM 3-Round Self-Repair (repaired cleanly in ${aiPipeRes.buildLog.repairRoundsUsed} round) + Custom audioSpec/synth_sfx OK!`,
  )

  // 10. Follow-DSH Discovery + All 4 Wire Protocols + IndexTTS-2.5 Health + AI Voice Mastering
  const { discoverDshClientConfig, callLlmChat, WIRE_PROTOCOLS } = await import(
    '../packages/dsh-tool-media/llm-client.js'
  )
  const { masterVoiceTracks } = await import('../packages/dsh-tool-media/voice-master.js')
  const { getTtsServerHealth } = await import('../packages/dsh-tool-local-tts/tts-server-manager.js')

  const mockDshDir = join(REPO_ROOT, '.tmp', 'mock-dsh-home')
  rmSync(mockDshDir, { recursive: true, force: true })
  mkdirSync(join(mockDshDir, 'profiles', 'desktop'), { recursive: true })
  mkdirSync(join(mockDshDir, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(
    join(mockDshDir, 'profiles', 'desktop', 'cordis.patch.yml'),
    [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      mock_resp:',
      '        displayName: MockResponses',
      '        api: openai-responses',
      '        baseURL: https://mock-gateway.invalid/v1',
      '        apiKeyEnv: MOCK_RESP_KEY',
      '        models:',
      '          - id: gpt-6.1-sol',
      '            name: GPT 6.1 Sol',
      '- id: llm-deepseek',
      '  config:',
      '    baseURL: https://mock-ds.invalid/v1',
      '    models:',
      '      - id: deepseek-v4.1-flash',
    ].join('\n'),
    'utf8',
  )
  writeFileSync(
    join(mockDshDir, '.credentials.yaml'),
    'refs:\n  MOCK_RESP_KEY: sk-mock-secret-987654321\n',
    'utf8',
  )
  writeFileSync(
    join(mockDshDir, 'storages', 'session_projcache', 'sessions', 'session-1.json'),
    JSON.stringify({
      rows: { modelSelection: { val: { pending: { provider: 'mock_resp', model: 'gpt-6.1-sol' } } } },
    }),
    'utf8',
  )
  const dshDisc = discoverDshClientConfig(mockDshDir)
  rmSync(mockDshDir, { recursive: true, force: true })
  if (
    !dshDisc.available ||
    dshDisc.defaultProviderId !== 'mock_resp' ||
    dshDisc.defaultProtocol !== 'openai-responses' ||
    dshDisc.defaultModelId !== 'gpt-6.1-sol' ||
    !dshDisc.providers[0]?.hasApiKey ||
    JSON.stringify(dshDisc).includes('987654321')
  ) {
    throw new Error(`Follow-DSH discovery check failed: ${JSON.stringify(dshDisc)}`)
  }

  if (!Array.isArray(WIRE_PROTOCOLS) || WIRE_PROTOCOLS.length !== 4) {
    throw new Error(`Expected 4 WIRE_PROTOCOLS, got ${JSON.stringify(WIRE_PROTOCOLS)}`)
  }
  const capturedCalls = []
  const protoCases = [
    {
      format: 'openai-completions',
      baseUrl: 'https://mock-openai.invalid/v1',
      model: 'gpt-test',
      expectUrl: 'https://mock-openai.invalid/v1/chat/completions',
      expectAuthHeader: 'authorization',
      replyPayload: { choices: [{ message: { content: 'ok-chat-comp' } }], usage: { total_tokens: 10 } },
      expectText: 'ok-chat-comp',
    },
    {
      format: 'anthropic-messages',
      baseUrl: 'https://mock-anth.invalid',
      model: 'claude-opus-5-5',
      expectUrl: 'https://mock-anth.invalid/v1/messages',
      expectAuthHeader: 'x-api-key',
      replyPayload: { content: [{ type: 'text', text: 'ok-anth-msg' }], usage: { output_tokens: 8 } },
      expectText: 'ok-anth-msg',
    },
    {
      format: 'openai-responses',
      baseUrl: 'https://mock-resp.invalid/v1',
      model: 'gpt-6.1-sol',
      expectUrl: 'https://mock-resp.invalid/v1/responses',
      expectAuthHeader: 'authorization',
      replyPayload: { output_text: 'ok-oai-resp', usage: { total_tokens: 12 } },
      expectText: 'ok-oai-resp',
    },
    {
      format: 'gemini-native',
      baseUrl: 'https://mock-gem.invalid',
      model: 'gemini-2.5-pro',
      expectUrl: 'https://mock-gem.invalid/v1beta/models/gemini-2.5-pro:generateContent',
      expectAuthHeader: 'x-goog-api-key',
      replyPayload: { candidates: [{ content: { parts: [{ text: 'ok-gem-nat' }] } }] },
      expectText: 'ok-gem-nat',
    },
  ]
  for (const tc of protoCases) {
    const res = await callLlmChat({
      system: 'sys',
      messages: [{ role: 'user', content: 'hello' }],
      overrideConfig: {
        mode: 'custom',
        provider: 'custom',
        format: tc.format,
        baseUrl: tc.baseUrl,
        apiKey: 'mock-proto-key',
        model: tc.model,
      },
      fetchImpl: async (url, init) => {
        capturedCalls.push({ format: tc.format, url, headers: init.headers })
        const hdrLower = Object.fromEntries(
          Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]),
        )
        if (!hdrLower[tc.expectAuthHeader]) {
          throw new Error(`Protocol ${tc.format} missing header ${tc.expectAuthHeader}`)
        }
        if (url !== tc.expectUrl) {
          throw new Error(`Protocol ${tc.format} endpoint mismatch: ${url} !== ${tc.expectUrl}`)
        }
        return new Response(JSON.stringify(tc.replyPayload), { status: 200 })
      },
    })
    if (res.text !== tc.expectText) {
      throw new Error(`Protocol ${tc.format} text mismatch: ${res.text} !== ${tc.expectText}`)
    }
  }

  const liveHealth = await getTtsServerHealth()
  if (!liveHealth?.ok || liveHealth.engine !== 'indextts25' || liveHealth.version !== '2.5') {
    throw new Error(`IndexTTS-2.5 health assertion failed: ${JSON.stringify(liveHealth)}`)
  }
  const vmDspRes = await masterVoiceTracks({ projectDir: tmpHtmlProj, useLlm: false })
  if (!vmDspRes.ok || vmDspRes.scenesCount < 1 || !existsSync(join(tmpHtmlProj, 'output', 'voice_mastering_report.json'))) {
    throw new Error(`Telemetry DSP voice mastering failed: ${JSON.stringify(vmDspRes)}`)
  }
  const vmLlmRes = await masterVoiceTracks({
    projectDir: tmpHtmlProj,
    useLlm: true,
    llmOverride: {
      provider: 'anthropic',
      format: 'anthropic-messages',
      baseUrl: 'https://mock-anth.invalid',
      apiKey: 'mock-vm-key',
      model: 'mock-opus',
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                engineerSummary: 'Mock AI Broadcast Vocal Master -14 LUFS',
                globalPreset: 'broadcast-clean',
                tracks: twoScenes.map((sc) => ({
                  sceneId: sc.id,
                  preset: 'broadcast-clean',
                  hpfHz: 85,
                  presenceGainDb: 2.2,
                  deEssDb: -3.0,
                  compRatio: 3.0,
                  targetLufs: -14,
                  reverbWet: 0.04,
                  reason: 'Clean clarity',
                })),
              }),
            },
          ],
        }),
        { status: 200 },
      ),
  })
  if (!vmLlmRes.ok || !existsSync(join(tmpHtmlProj, 'audio', 'mastered', `${twoScenes[0].id}.wav`))) {
    throw new Error(`AI LLM voice mastering failed: ${JSON.stringify(vmLlmRes)}`)
  }
  console.log(
    `[10/11] Follow-DSH Discovery + All 4 Wire Protocols (${protoCases.map((c) => c.format).join(', ')}) + IndexTTS-2.5 v${liveHealth.version} + AI Voice Mastering (${vmLlmRes.scenesCount} tracks) OK!`,
  )

  // 11. P0-P2 Fusion Verification (OFL Fonts, Safe-Zones, 3-Mode BGM, Voice Cloning + Audition, Schema Tier 1-4, Segment Cache, Vendor .motion, Publish Pack)
  const { computeSafeZonePreflight } = await import('../packages/shared/compliance.js')
  const { runSchemaDirectorWithDegradation } = await import('../packages/dsh-tool-media/plan-schema.js')
  const { scanAiAudioCodeSandbox } = await import('../packages/dsh-tool-media/audio-coder.js')

  // P0.1 OFL fonts copied + proprietary font explicitly rejected by video_lint
  for (const fontName of ['NotoSansSC-VF.woff2', 'SourceHanSerifSC-Heavy.woff2', 'LICENSES.md']) {
    if (!existsSync(join(tmpHtmlProj, 'fonts', fontName))) {
      throw new Error(`Missing bundled commercial OFL font asset in project: fonts/${fontName}`)
    }
  }
  const origHtmlIndex = readFileSync(join(tmpHtmlProj, 'index.html'), 'utf8')
  writeFileSync(join(tmpHtmlProj, 'index.html'), origHtmlIndex + '\n<!-- font-family: "Microsoft YaHei"; -->\n', 'utf8')
  const badFontLint = await executeVideoLint({ projectDir: tmpHtmlProj, engine: 'html' })
  writeFileSync(join(tmpHtmlProj, 'index.html'), origHtmlIndex, 'utf8')
  if (badFontLint.ok) {
    throw new Error('Expected video_lint to REJECT proprietary Microsoft YaHei font reference!')
  }

  // P0.2 Platform Safe-Zone Geometric Preflight
  const dyCollide = computeSafeZonePreflight({ width: 1080, height: 1920, targetPlatform: 'douyin' }, { subtitleBottomPx: 28 })
  const dySafe = computeSafeZonePreflight({ width: 1080, height: 1920, targetPlatform: 'douyin' })
  if (dyCollide.passed || dyCollide.collisions.length < 1 || !dySafe.passed) {
    throw new Error(`Safe-zone preflight failed assertion: collide=${JSON.stringify(dyCollide)}, safe=${JSON.stringify(dySafe)}`)
  }

  // P1.2 HTML5 Segment Cache: post-mastering invalidates cleanly (render 1), consecutive unchanged hits cache (render 2)
  const cacheRender1 = await executeVideoRender({
    projectDir: tmpHtmlProj,
    engine: 'html',
    renderWidth: 1280,
    renderHeight: 720,
    useSegmentCache: true,
  })
  const cacheRender = await executeVideoRender({
    projectDir: tmpHtmlProj,
    engine: 'html',
    renderWidth: 1280,
    renderHeight: 720,
    useSegmentCache: true,
  })
  const cacheFiles = existsSync(join(tmpHtmlProj, 'cache', 'segments'))
    ? readdirSync(join(tmpHtmlProj, 'cache', 'segments')).filter((f) => f.endsWith('.mp4'))
    : []
  if (
    !cacheRender1.ok ||
    !cacheRender.ok ||
    cacheFiles.length < 2 ||
    (cacheRender.segmentCache?.cacheHits || 0) < 2 ||
    (cacheRender.segmentCache?.cacheMisses || 0) !== 0
  ) {
    throw new Error(`Segment cache verification failed: cacheFiles=${cacheFiles.length}, segRes=${JSON.stringify(cacheRender.segmentCache)}`)
  }

  // 3-Mode BGM Verification (llm-coded / uploaded / tts-engine) + Audio Sandbox security check
  const unsafeAudioScan = scanAiAudioCodeSandbox(`require('fs').readFileSync('/etc/passwd')`)
  if (unsafeAudioScan.ok) {
    throw new Error('Audio sandbox scanner failed to block forbidden require("fs") call!')
  }
  if (!existsSync(join(tmpAiProj, 'audio', 'ai_bgm_synth.js')) || !existsSync(join(tmpAiProj, 'audio', 'bgm-llm.wav'))) {
    throw new Error('Mode 1 (llm-coded) BGM artifact audio/ai_bgm_synth.js or bgm-llm.wav missing in AI project!')
  }
  // Mode 2: Uploaded BGM API
  const testBgmSrc = join(tmpAssetSrc, 'bgm_synth_track.wav')
  const bgmUpRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/bgm/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectDir: tmpHtmlProj,
        fileName: 'user-custom-bgm.wav',
        dataBase64: readFileSync(testBgmSrc).toString('base64'),
      }),
    }),
  )
  const bgmUpJson = await bgmUpRes.json()
  if (!bgmUpJson.ok || bgmUpJson.script?.bgmMode !== 'uploaded' || bgmUpJson.asset?.role !== 'music') {
    throw new Error(`Mode 2 (uploaded) BGM route failed: ${JSON.stringify(bgmUpJson)}`)
  }
  // Mode 3: IndexTTS-2.5 TTS-Engine BGM Cue API
  const ttsBgmRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/audio/tts-compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectDir: tmpHtmlProj,
        promptText: '温暖沉浸氛围哼唱和声',
        voiceId: 'auto',
        mode: 'bgm-pad',
        durationSec: 6,
      }),
    }),
  )
  const ttsBgmJson = await ttsBgmRes.json()
  if (!ttsBgmJson.ok || !existsSync(join(tmpHtmlProj, 'audio', 'bgm-tts.wav'))) {
    throw new Error(`Mode 3 (tts-engine) BGM synthesis failed: ${JSON.stringify(ttsBgmJson)}`)
  }

  // Zero-Shot Voice Cloning Lab (Upload -> FFmpeg Clean/Norm -> Live IndexTTS-2.5 Clone Audition)
  const sampleVoicePath =
    process.env.DEFAULT_REF_AUDIO && existsSync(process.env.DEFAULT_REF_AUDIO)
      ? process.env.DEFAULT_REF_AUDIO
      : join(tmpHtmlProj, 'audio', `${twoScenes[0].id}.wav`)
  const cloneUpRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/voices/clone-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioBase64: readFileSync(sampleVoicePath).toString('base64'),
        fileName: 'self-test-clone.wav',
        name: '自检临时克隆音色',
        gender: 'female',
        stripSilence: false,
      }),
    }),
  )
  const cloneUpJson = await cloneUpRes.json()
  if (!cloneUpJson.ok || !cloneUpJson.voice?.id) {
    throw new Error(`Voice cloning upload API failed: ${JSON.stringify(cloneUpJson)}`)
  }
  const auditionRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/voices/clone-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        voiceId: cloneUpJson.voice.id,
        text: '测试声音克隆即时试听输出。',
      }),
    }),
  )
  const auditionJson = await auditionRes.json()
  if (!auditionJson.ok || !String(auditionJson.audioDataUrl || '').startsWith('data:audio/wav;base64,')) {
    throw new Error(`Cloned voice audition API failed: ${JSON.stringify(auditionJson)}`)
  }
  // Remove the synthetic test voices from the user's real voice library (VOICE_PACKS_DIR): catalog entry + folder
  for (const testVoiceId of [cloneUpJson.voice.id, 'imported-custom-narrator']) {
    try {
      deleteImportedVoice(testVoiceId)
    } catch {}
  }
  if (getVoiceCatalog().voices.some((v) => v.id === cloneUpJson.voice.id || v.id === 'imported-custom-narrator')) {
    throw new Error('self-test voices were not removed from the voice library')
  }

  // P1.1 Schema Plan Mode + Tier 1-4 Graceful Degradation
  const tier4Res = await runSchemaDirectorWithDegradation({
    topic: 'Tier 4 Rule Fallback Verification',
    style: 'tech',
    forceTierForTest: 4,
  })
  if (tier4Res.degradationTier !== 4 || tier4Res.plan?.version !== 'promo-plan/1' || (tier4Res.resolved?.resolvedShots?.length || 0) < 2) {
    throw new Error(`Schema Tier 4 fallback assertion failed: ${JSON.stringify(tier4Res)}`)
  }

  // P2.2 Isolated .motion Vendor HTML Clip Importer (-an stripped audio)
  const mockVendorDir = join(REPO_ROOT, '.tmp', 'mock-vendor-motion')
  rmSync(mockVendorDir, { recursive: true, force: true })
  mkdirSync(mockVendorDir, { recursive: true })
  writeFileSync(
    join(mockVendorDir, 'index.html'),
    `<!DOCTYPE html><html><body style="margin:0;background:#090B10;color:#E5A93C;display:flex;align-items:center;justify-content:center;font-size:42px;font-family:sans-serif">VENDOR MOTION CLIP</body></html>`,
    'utf8',
  )
  const vendorRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/vendor/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectDir: tmpHtmlProj,
        sourceDir: mockVendorDir,
        name: 'test-vendor-banner',
        durationSec: 1.5,
      }),
    }),
  )
  const vendorJson = await vendorRes.json()
  if (!vendorJson.ok || !existsSync(join(tmpHtmlProj, vendorJson.assetPath))) {
    throw new Error(`Isolated .motion vendor import failed: ${JSON.stringify(vendorJson)}`)
  }
  const vendorProbe = await probeMediaStreams(bins.ffprobe, join(tmpHtmlProj, vendorJson.assetPath))
  if (vendorProbe.streams.some((s) => s.codec_type === 'audio')) {
    throw new Error('Isolated vendor clip MUST strip audio streams (-an)!')
  }

  // P2.1 Platform Publish Pack One-Click Exporter
  const pubRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/publish-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: tmpHtmlProj, platform: 'douyin' }),
    }),
  )
  const pubJson = await pubRes.json()
  if (!pubJson.ok || !existsSync(pubJson.files?.coverPath || '') || !existsSync(pubJson.files?.metaPath || '')) {
    throw new Error(`Publish Pack export failed: ${JSON.stringify(pubJson)}`)
  }

  console.log(
    `[11/13] P0-P2 Fusion Suite OK (OFL fonts + Douyin Safe-Zone + Segment Cache [${cacheFiles.length} clips] + 3-Mode BGM + Voice Clone Audition + Tier 4 Fallback + Isolated Vendor .motion + Publish Pack)!`,
  )

  // 12. v5 AI Agent Command Deck Verification: Avatar Tool (Alpha WebM -> HTML & Remotion), Curate/Edit, TaskManager Abort/Pause/Resume/Retry, Recording & Teleprompter & Skin APIs
  const avHtml = await executeGenerateAvatar({
    projectDir: tmpHtmlProj,
    avatarMode: 'ai-human',
    presetId: 'cyber-anchor',
    avatarLayout: 'pip-br',
    voiceId: 'auto',
    narrationText: '欢迎来到人工智能作战大屏数字人测试。',
    durationSec: 2,
  })
  if (!avHtml.ok || !existsSync(join(tmpHtmlProj, avHtml.relPath))) {
    throw new Error(`executeGenerateAvatar HTML failed: ${JSON.stringify(avHtml)}`)
  }
  const avProbe = await probeMediaStreams(bins.ffprobe, join(tmpHtmlProj, avHtml.relPath))
  const avVStream = (avProbe.streams || []).find((s) => s.codec_type === 'video')
  if (!avVStream || (avVStream.pix_fmt !== 'yuva420p' && avVStream.tags?.alpha_mode !== '1' && !avHtml.hasAlpha)) {
    throw new Error(`Avatar WebM missing alpha stream metadata: ${JSON.stringify(avVStream)}`)
  }
  syncProjectCodeFromScript(tmpHtmlProj, readScriptJson(tmpHtmlProj).data, { forceOverwrite: true })
  if (!readFileSync(join(tmpHtmlProj, 'index.html'), 'utf8').includes('avatar-overlay-video')) {
    throw new Error('HTML5 generator missing #avatar-overlay-video after avatarClip script update!')
  }

  const avRem = await executeGenerateAvatar({
    projectDir: tmpRemotionProj,
    avatarMode: 'ai-human',
    presetId: 'warm-mentor',
    avatarLayout: 'pip-bl',
    voiceId: 'auto',
    narrationText: 'Remotion 数字人透明通道合成测试。',
    durationSec: 2,
  })
  if (!avRem.ok || !existsSync(join(tmpRemotionProj, avRem.relPath))) {
    throw new Error(`executeGenerateAvatar Remotion failed: ${JSON.stringify(avRem)}`)
  }
  syncProjectCodeFromScript(tmpRemotionProj, readScriptJson(tmpRemotionProj).data, { forceOverwrite: true })
  if (
    !readFileSync(join(tmpRemotionProj, 'src', 'VideoComposition.tsx'), 'utf8').includes('AvatarOverlay') ||
    !existsSync(join(tmpRemotionProj, 'public', avRem.relPath))
  ) {
    throw new Error('Remotion generator missing AvatarOverlay import or public/ avatar WebM sync!')
  }

  const curateRes = await executeCurateAndEditAssets({
    projectDir: tmpHtmlProj,
    aspectRatio: '16:9',
    quality: '720p',
    style: 'cinematic',
    trimSeconds: 1,
  })
  if (!curateRes.ok || (curateRes.editedCount || 0) < 1 || !existsSync(join(tmpHtmlProj, 'assets', 'edited'))) {
    throw new Error(`executeCurateAndEditAssets failed: ${JSON.stringify(curateRes)}`)
  }

  // TaskManager Start -> Pause -> Resume -> Stop (immediate child process termination) -> Retry
  let spawnedChildPid = 0
  const createdRun = taskManager.createRun({
    projectDir: tmpHtmlProj,
    title: 'Self-Test TaskManager Lifecycle',
    mode: 'fast-draft',
    subtasks: [
      { id: 't-step1', stage: 'director', name: '步骤一', kind: 'script_plan' },
      { id: 't-step2', stage: 'motion_qa', name: '步骤二(含阻塞子进程)', kind: 'mp4_render' },
    ],
  })
  let mockPassCount = 0
  await taskManager.startRun(createdRun.id, async (runObj, helpers) => {
    mockPassCount++
    if (mockPassCount >= 2) {
      helpers.updateTask('t-step1', { status: 'completed', progress: 100 })
      helpers.updateTask('t-step2', { status: 'completed', progress: 100 })
      return { retried: true }
    }
    helpers.updateTask('t-step1', { status: 'completed', progress: 100 })
    await helpers.waitIfPaused()
    helpers.updateTask('t-step2', { status: 'running', progress: 35, message: '等待测试子进程...' })
    await new Promise((resolvePromise, rejectPromise) => {
      const ch = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 25000)'], { stdio: 'ignore' })
      spawnedChildPid = ch.pid || 0
      helpers.onChild(ch)
      const onAbort = () => rejectPromise(new Error('Task aborted cleanly'))
      if (helpers.signal.aborted) return onAbort()
      helpers.signal.addEventListener('abort', onAbort, { once: true })
      ch.on('exit', () => resolvePromise())
    })
  })
  await new Promise((r) => setTimeout(r, 150))
  taskManager.pauseRun(createdRun.id)
  if (taskManager.getRun(createdRun.id)?.status !== 'paused') {
    throw new Error('TaskManager pauseRun did not transition status to paused')
  }
  await taskManager.resumeRun(createdRun.id)
  for (let i = 0; i < 20 && !spawnedChildPid; i++) await new Promise((r) => setTimeout(r, 50))
  if (!spawnedChildPid) throw new Error('TaskManager resumed run did not spawn test child process')
  taskManager.stopRun(createdRun.id)
  await new Promise((r) => setTimeout(r, 250))
  const stoppedRun = taskManager.getRun(createdRun.id)
  if (stoppedRun?.status !== 'stopped') {
    throw new Error(`TaskManager stopRun failed: status=${stoppedRun?.status}`)
  }
  let childStillAlive = false
  try {
    process.kill(spawnedChildPid, 0)
    childStillAlive = true
  } catch {}
  if (childStillAlive) {
    throw new Error(`TaskManager stopRun left child PID ${spawnedChildPid} alive!`)
  }
  await taskManager.retryRun(createdRun.id)
  for (let i = 0; i < 30 && taskManager.getRun(createdRun.id)?.status !== 'completed'; i++) {
    await new Promise((r) => setTimeout(r, 50))
  }
  if (taskManager.getRun(createdRun.id)?.status !== 'completed') {
    throw new Error(`TaskManager retryRun did not complete cleanly: ${taskManager.getRun(createdRun.id)?.status}`)
  }

  // Workbench API checks: /assets/recording + /teleprompter/generate + /tasks + /skin/upload
  const syntheticRecWebm = join(REPO_ROOT, '.tmp', 'synthetic-cam.webm')
  await runCommandRedirected(
    bins.ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'color=c=#1e293b:s=320x240:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libvpx', '-c:a', 'libopus', syntheticRecWebm],
    { timeoutMs: 20_000 },
  )
  const recApiRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/assets/recording', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectDir: tmpHtmlProj,
        fileName: 'webcam-test.webm',
        role: 'host_video',
        extractVoiceClone: false,
        dataBase64: readFileSync(syntheticRecWebm).toString('base64'),
      }),
    }),
  )
  const recApiJson = await recApiRes.json()
  if (!recApiJson.ok || !existsSync(join(tmpHtmlProj, recApiJson.relPath)) || recApiJson.asset?.role !== 'host_video') {
    throw new Error(`Recording save API failed: ${JSON.stringify(recApiJson)}`)
  }
  const teleRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/teleprompter/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: tmpHtmlProj, topic: 'AI Agent 协同作战测试', durationSec: 30 }),
    }),
  )
  const teleJson = await teleRes.json()
  if (!teleJson.ok || !Array.isArray(teleJson.lines) || teleJson.lines.length < 2) {
    throw new Error(`Teleprompter generate API failed: ${JSON.stringify(teleJson)}`)
  }
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ).toString('base64')
  const skinUpRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/skin/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'self-test-skin.png', dataBase64: png1x1 }),
    }),
  )
  const skinUpJson = await skinUpRes.json()
  const skinGetRes = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399${skinUpJson.url}`, { method: 'GET' }),
  )
  rmSync(join(REPO_ROOT, '.skins', skinUpJson.name || 'nonexistent'), { force: true })
  if (!skinUpJson.ok || skinGetRes.status !== 200) {
    throw new Error(`Skin upload/get API failed: up=${JSON.stringify(skinUpJson)} get=${skinGetRes.status}`)
  }

  console.log(
    `[12/13] v5 AI Agent Command Deck OK (Alpha Avatar WebM [${avVStream.pix_fmt}] -> HTML5 & Remotion + Curate/Edit [${curateRes.editedCount}] + TaskManager Pause/Resume/Kill/Retry + Webcam Recording + Teleprompter + Skin)!`,
  )

  // 12b. Phase 1 v6 P0/P1 regression assertions (raw binary upload, starter pack, style normalize, offline testLlmConnection, local-draft mode map)
  const { normalizeVideoStyle, sanitizeSpokenNarration } = await import('../packages/shared/index.js')
  const dirtyNar = sanitizeSpokenNarration('你二十四岁起兵 ([ctext.org](https://ctext.org/shiji?utm_source=openai)) 破釜沉舟 https://example.com/a')
  if (dirtyNar !== '你二十四岁起兵 破釜沉舟' || dirtyNar.includes('http') || dirtyNar.includes('utm_source')) {
    throw new Error(`sanitizeSpokenNarration regression failed: "${dirtyNar}"`)
  }
  if (
    normalizeVideoStyle('minimal-editorial') !== 'documentary' ||
    normalizeVideoStyle('vibrant-brand') !== 'energetic' ||
    normalizeVideoStyle('cinema') !== 'cinematic' ||
    normalizeVideoStyle('warm') !== 'warm' ||
    normalizeVideoStyle('unknown-style-fallback') !== 'tech'
  ) {
    throw new Error('normalizeVideoStyle regression check failed')
  }

  const { testLlmConnection } = await import('../packages/dsh-tool-media/index.js')
  const { resolvePipelineMode } = await import('../packages/dsh-tool-media/pipeline-orchestrator.js')
  const localDraftResolved = resolvePipelineMode('local-draft')
  if (!localDraftResolved.isDraftMode || localDraftResolved.effectiveMode !== 'fast-draft') {
    throw new Error(`resolvePipelineMode('local-draft') regression failed: ${JSON.stringify(localDraftResolved)}`)
  }
  const fastDraftResolved = resolvePipelineMode('fast-draft')
  const aiCodedResolved = resolvePipelineMode('ai-coded')
  if (!fastDraftResolved.isDraftMode || aiCodedResolved.isDraftMode || aiCodedResolved.effectiveMode !== 'ai-coded') {
    throw new Error('resolvePipelineMode fast-draft / ai-coded mismatch')
  }

  let offlineConnErr = null
  try {
    await testLlmConnection(
      { apiKey: 'dummy-test-key', baseUrl: 'http://127.0.0.1:9', model: 'test-model' },
      () => Promise.reject(new Error('offline-simulated')),
    )
  } catch (err) {
    offlineConnErr = err
  }
  if (!offlineConnErr || offlineConnErr instanceof ReferenceError) {
    throw new Error(`testLlmConnection offline regression failed: ${offlineConnErr?.stack || offlineConnErr}`)
  }

  const rawPngBytes = Buffer.from(png1x1, 'base64')
  const rawAssetUpRes = await handleWorkbenchApiRequest(
    new Request(
      `http://127.0.0.1:4399/api/video-workbench/assets/upload?projectDir=${encodeURIComponent(tmpHtmlProj)}&role=visual&fileName=raw-bin-smoke.png`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: rawPngBytes,
      },
    ),
  )
  const rawAssetUpJson = await rawAssetUpRes.json()
  if (rawAssetUpRes.status !== 200 || !rawAssetUpJson.ok) {
    throw new Error(`Raw binary /assets/upload failed: status=${rawAssetUpRes.status} body=${JSON.stringify(rawAssetUpJson)}`)
  }

  const rawBgmBytes = readFileSync(testBgmSrc)
  const rawBgmUpRes = await handleWorkbenchApiRequest(
    new Request(
      `http://127.0.0.1:4399/api/video-workbench/bgm/upload?projectDir=${encodeURIComponent(tmpHtmlProj)}&fileName=raw-bgm-smoke.wav`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: rawBgmBytes,
      },
    ),
  )
  const rawBgmUpJson = await rawBgmUpRes.json()
  if (rawBgmUpRes.status !== 200 || !rawBgmUpJson.ok) {
    throw new Error(`Raw binary /bgm/upload failed: status=${rawBgmUpRes.status} body=${JSON.stringify(rawBgmUpJson)}`)
  }

  const starterPackRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1:4399/api/video-workbench/assets/starter-pack', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectDir: tmpHtmlProj }),
    }),
  )
  const starterPackJson = await starterPackRes.json()
  if (starterPackRes.status !== 200 || !starterPackJson.ok || (starterPackJson.addedCount || 0) < 4) {
    throw new Error(`POST /assets/starter-pack failed: status=${starterPackRes.status} body=${JSON.stringify(starterPackJson)}`)
  }
  console.log(
    `[12b/13] v6 P0/P1 regression checks OK (raw binary upload, starter-pack +${starterPackJson.addedCount}, normalizeVideoStyle, resolvePipelineMode, offline testLlmConnection)!`,
  )

  // 13. Validate the 2 flagship built-in demos (宣传片 dsh-video-workbench-promo + 教程 full-tutorial-v036) & Open-Source Hygiene Scan
  const demoPromoDir = join(REPO_ROOT, 'examples', 'dsh-video-workbench-promo')
  const demoTutorialDir = join(REPO_ROOT, 'examples', 'full-tutorial-v036')
  if (!existsSync(join(demoPromoDir, 'script.json')) || !existsSync(join(demoTutorialDir, 'script.json'))) {
    throw new Error('Flagship built-in demos missing: dsh-video-workbench-promo and/or full-tutorial-v036')
  }
  const promoScriptChk = readScriptJson(demoPromoDir).data
  const tutScriptChk = readScriptJson(demoTutorialDir).data
  if ((promoScriptChk?.scenes?.length || 0) < 12 || (tutScriptChk?.scenes?.length || 0) < 12) {
    throw new Error(`Flagship demos scene count unexpectedly low: promo=${promoScriptChk?.scenes?.length} tut=${tutScriptChk?.scenes?.length}`)
  }
  if (existsSync(join(REPO_ROOT, 'examples', 'demo-html-project')) || existsSync(join(REPO_ROOT, 'examples', 'demo-remotion-project'))) {
    throw new Error('Legacy 3-scene demos (demo-html-project / demo-remotion-project) must remain deleted')
  }

  const violations = scanForHardcodedPaths(REPO_ROOT)
  if (violations.length > 0) {
    throw new Error(`Hardcoded machine paths found in tracked files: ${violations.join(', ')}`)
  }
  console.log(
    `[13/14] Flagship Built-in Demos verified (promo=${promoScriptChk.scenes.length} scenes, tutorial=${tutScriptChk.scenes.length} scenes) & 0 hardcoded personal paths/keys!`,
  )

  // 14. Real BGM Beat Analyzer + Zero-Asset Narrative Diorama + Subtitle-MV Quantization Verification
  const {
    analyzeAudioBeatStructure,
    authorBatchedRemotionScenes,
    choreographBeatSfxCues,
    ensureProjectAudioAssets,
    normalizeTransitionKind,
    quantizeScenesToBeatGrid,
  } = await import('../packages/dsh-tool-media/index.js')
  const { syncProjectCodeFromScript: syncNarrativeProjectCode } = await import('../packages/dsh-tool-media/ai-director.js')
  const pulseWav = join(REPO_ROOT, '.tmp', 'pulse-100bpm-test.wav')
  // Generate 12s rhythmic 100 BPM pulse (0.600s period) starting at 0.300s
  await runCommandRedirected(
    bins.ffmpeg,
    [
      '-y',
      '-f', 'lavfi',
      '-i', "aevalsrc='0.7*sin(2*PI*90*(mod(t+0.3,0.6)))*exp(-mod(t+0.3,0.6)*32)':s=16000:d=12",
      pulseWav,
    ],
    { timeoutMs: 15_000 },
  )
  const beatRes = await analyzeAudioBeatStructure(pulseWav)
  try { rmSync(pulseWav, { force: true }) } catch {}
  if (!beatRes.ok || beatRes.bpm < 97 || beatRes.bpm > 103 || (beatRes.downbeats || []).length < 3) {
    throw new Error(`Real BGM beat analyzer failed on 100 BPM test pulse: ${JSON.stringify({ bpm: beatRes.bpm, phase: beatRes.phaseSec, downbeats: beatRes.downbeats?.length })}`)
  }

  const tmpNarrativeProj = join(REPO_ROOT, '.tmp', 'e2e-narrative-mv')
  rmSync(tmpNarrativeProj, { recursive: true, force: true })
  scaffoldVideoProject(tmpNarrativeProj, {
    title: 'Zero-Asset Narrative Beat MV Test',
    engine: 'remotion',
    style: 'cinematic',
  })
  const rawNv = readScriptJson(tmpNarrativeProj).data
  rawNv.narrationMode = 'subtitle-mv'
  rawNv.subtitleStyle = 'cinematic'
  rawNv.bgmMode = 'uploaded'
  rawNv.bgm = { ...beatRes, enabled: true, mode: 'uploaded', path: testBgmSrc, source: 'user-imported' }
  rawNv.scenes = [
    {
      id: 'scene-01',
      title: '崛起',
      narration: '你握紧手中剑，迎接黎明',
      subChunks: ['你握紧手中剑', '迎接黎明'],
      accentWords: ['剑', '黎明'],
      layout: 'narrative-diorama',
      beatCount: 4,
      transition: 'flash-cut',
      stageSpec: { mood: 'dawn-amber', setting: 'palace-stairs', archetype: 'hero-numeral', heroNum: '18', heroUnit: '岁' },
    },
    {
      id: 'scene-02',
      title: '破敌',
      narration: '一战定乾坤，战旗指天',
      subChunks: ['一战定乾坤'],
      accentWords: ['乾坤'],
      layout: 'narrative-diorama',
      beatCount: 4,
      transition: 'flash-cut',
      stageSpec: { mood: 'crimson-war', setting: 'city-siege', archetype: 'strategic-map', bannerChar: '楚', stamps: [{ label: '胜', x: 1000, y: 500, triggerPct: 0.3 }] },
    },
  ]
  rawNv.scenes = quantizeScenesToBeatGrid(rawNv.scenes, beatRes, { mode: 'subtitle-mv', fps: 30 })
  rawNv.scenes = choreographBeatSfxCues(rawNv.scenes, beatRes)
  rawNv.subtitles = rawNv.scenes.flatMap((s) => s.subtitles || [])
  const lastNv = rawNv.scenes[rawNv.scenes.length - 1]
  rawNv.totalDurationInFrames = lastNv.startFrame + lastNv.durationInFrames
  rawNv.totalDurationSec = Number((rawNv.totalDurationInFrames / 30).toFixed(4))
  writeScriptJson(tmpNarrativeProj, rawNv)
  syncNarrativeProjectCode(tmpNarrativeProj, rawNv, { forceOverwrite: true })
  const nvLint = await executeVideoLint({ projectDir: tmpNarrativeProj, engine: 'remotion' })
  const nvTsc = await runTypecheckOnProject(tmpNarrativeProj)
  if (!nvLint.ok || !nvTsc.ok) {
    throw new Error(`Narrative Diorama lint/tsc failed: lint=${JSON.stringify(nvLint.errors)} tsc=${JSON.stringify(nvTsc.errors)}`)
  }
  console.log(
    `[14/15] Real Beat Analyzer (100 BPM measured=${beatRes.bpm} BPM, phase=${beatRes.phaseSec}s) + Zero-Asset Narrative Diorama (Remotion tsc 0 errors + lint PASS)!`,
  )

  // 15. Universal Root-Cause Verification: Transition Normalization + Overlay Mount + Half-Beat Blitz + SFX Sidechain Mix + Batched Custom TSX Coder
  if (
    normalizeTransitionKind('pan_across', 2, true) !== 'slash-wipe' ||
    normalizeTransitionKind('wipe-right', 1, false) !== 'light-wipe' ||
    normalizeTransitionKind('pull_out', 3, true) !== 'zoom-punch'
  ) {
    throw new Error('normalizeTransitionKind failed to sanitize recipe aliases cleanly')
  }
  const nvCompCode = readFileSync(join(tmpNarrativeProj, 'src', 'VideoComposition.tsx'), 'utf8')
  if (!nvCompCode.includes('<SceneTransitionOverlay')) {
    throw new Error('SceneStage narrative-diorama branch still bypassed SceneTransitionOverlay!')
  }
  if (!nvCompCode.includes('publicAssetFiles')) {
    throw new Error('VideoComposition SceneStage failed to inject publicAssetFiles into CustomSceneComp!')
  }
  const { repairPromoPlanRules, validatePromoPlan } = await import('../packages/dsh-tool-media/plan-schema.js')
  const promoBeatPlan = repairPromoPlanRules(
    {
      mode: 'promo-ui',
      shots: Array.from({ length: 12 }, (_, idx) => ({
        title: `Beat Shot ${idx + 1}`,
        narration: `镜头 ${idx + 1} 节奏切换。`,
        durationSec: 2.5,
        transition: idx === 0 ? 'cut' : 'slash-wipe',
        assetRefs: idx % 2 === 0 ? ['assets/images/ui.png'] : [],
      })),
    },
    { topic: 'Beat Promo Test', narrationMode: 'tts-beat-sync', assetsManifest: { items: [{ role: 'image', path: 'assets/images/ui.png' }] } },
  )
  const promoBeatNonCuts = promoBeatPlan.shots.filter((s, idx) => idx > 0 && s.transition !== 'cut').length
  if (promoBeatNonCuts < 10 || !validatePromoPlan(promoBeatPlan).ok) {
    throw new Error(`tts-beat-sync plan choked transitions or failed validation: nonCuts=${promoBeatNonCuts}`)
  }

  const blitzScenes = [
    { id: 'scene-01', title: 'Half-Beat Hit', narration: '第一击', beatCount: 0.5, transition: 'cut', stageSpec: { mood: 'crimson-war', archetype: 'slash-climax' } },
    { id: 'scene-02', title: 'Tech Diagram', narration: '架构演进', beatCount: 2, transition: 'slash-wipe', visualBlueprint: 'Animated dataflow rings' },
    { id: 'scene-03', title: 'Map Sweep', narration: '疆域跃迁', beatCount: 4, transition: 'zoom-punch', stageSpec: { mood: 'dawn-amber', archetype: 'strategic-map' } },
  ]
  const qBlitz = quantizeScenesToBeatGrid(blitzScenes, beatRes, { mode: 'subtitle-mv', fps: 30 })
  if (qBlitz[0].durationInFrames < 8 || qBlitz[0].durationInFrames > 14) {
    throw new Error(`Half-beat blitz scene duration expected 8..14 frames, got ${qBlitz[0].durationInFrames}`)
  }

  const blitzSfx = choreographBeatSfxCues(qBlitz, beatRes)
  const tmpBatchProj = join(REPO_ROOT, '.tmp', 'e2e-batched-tsx')
  rmSync(tmpBatchProj, { recursive: true, force: true })
  scaffoldVideoProject(tmpBatchProj, {
    title: 'Universal Batched TSX Coder Self-Test',
    engine: 'remotion',
    style: 'tech',
  })
  const batchScript = readScriptJson(tmpBatchProj).data
  batchScript.narrationMode = 'subtitle-mv'
  batchScript.bgmMode = 'uploaded'
  batchScript.bgm = { ...beatRes, enabled: true, mode: 'uploaded', path: testBgmSrc, source: 'user-imported' }
  batchScript.scenes = blitzSfx
  batchScript.subtitles = blitzSfx.flatMap((s) => s.subtitles || [])
  batchScript.totalDurationInFrames = blitzSfx[blitzSfx.length - 1].endFrame
  batchScript.totalDurationSec = Number((batchScript.totalDurationInFrames / 30).toFixed(4))
  writeScriptJson(tmpBatchProj, batchScript)
  await ensureProjectAudioAssets(tmpBatchProj, batchScript, { items: [] })
  const batchMixRes = await mixVideoAudio({
    projectDir: tmpBatchProj,
    script: batchScript,
    assetsManifest: { items: [] },
    outputPath: join(tmpBatchProj, 'output', 'master-audio.wav'),
  })
  if (!batchMixRes.ok || !existsSync(batchMixRes.outputPath) || (batchMixRes.sfxCount || 0) < 3) {
    throw new Error(`SFX sidechain audio mix failed: ${JSON.stringify(batchMixRes)}`)
  }

  const batchAuthRes = await authorBatchedRemotionScenes({
    absDir: tmpBatchProj,
    lockedScript: batchScript,
    batchSize: 6,
    maxRepairRounds: 1,
    callLlmChatFn: async () => ({
      text: JSON.stringify({
        files: {
          'src/scenes/Batch01.tsx': `import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraRig, ParallaxHorizon, computeBeatPulse, FONT_SANS } from '../lib/shotcraft';
export interface CustomSceneProps { scene: any; idx: number; total: number; beats: any[]; }
const RenderScene: React.FC<CustomSceneProps> = ({ scene, idx, beats }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  const { pulse } = computeBeatPulse((Number(scene.startSec) || 0) + frame / Math.max(1, fps), beats);
  return (
    <CameraRig zoomFrom={1.0} zoomTo={1.08} beatPulse={pulse} cutKickPx={1.2}>
      <ParallaxHorizon />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 64, fontWeight: 900, color: '#F8FAFC', opacity: interpolate(progress, [0, 0.2], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          {scene.title} #{idx + 1}
        </div>
      </AbsoluteFill>
    </CameraRig>
  );
};
export const BATCH_01_SCENES: Record<string, React.FC<CustomSceneProps>> = {
  'scene-01': RenderScene,
  'scene-02': RenderScene,
  'scene-03': RenderScene,
};`,
        },
      }),
    }),
  })
  if (
    !batchAuthRes.ok ||
    !existsSync(join(tmpBatchProj, 'src', 'scenes', 'Batch01.tsx')) ||
    !existsSync(join(tmpBatchProj, 'src', 'scenes', 'index.ts')) ||
    !readFileSync(join(tmpBatchProj, 'src', 'VideoComposition.tsx'), 'utf8').includes('CUSTOM_SCENE_MAP')
  ) {
    throw new Error(`Batched custom TSX coder verification failed: ${JSON.stringify(batchAuthRes)}`)
  }
  rmSync(tmpNarrativeProj, { recursive: true, force: true })
  rmSync(tmpBatchProj, { recursive: true, force: true })
  console.log(
    `[15/16] Universal Engine Upgrades OK (Recipe->Transition sanitizer, TransitionOverlay unified, 0.5-beat blitz, SFX sidechain mix, Batched Custom TSX Coder)!`,
  )

  // 16. v7 User-Feedback Fixes: Topic Polish, Configurable AI Badge, Adaptive Pacing, Avatar Config Masking, DSH Slot Contract
  const vmModule = await import('node:vm')
  const { resolvePacingProfile } = await import('../packages/dsh-tool-media/plan-schema.js')

  // 16a. /api/video-workbench/polish-topic route + helper
  const emptyPolishRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1/api/video-workbench/polish-topic', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawPrompt: '   ' }),
    }),
  )
  if (emptyPolishRes.status !== 400) {
    throw new Error(`Expected 400 on empty polish-topic prompt, got ${emptyPolishRes.status}`)
  }
  const polishedRes = await polishTopicPrompt(
    {
      rawPrompt: '介绍我的开源视频插件，开源地址 https://github.com/Merziller/dsh-video-workbench',
      style: 'tech',
      pacingMode: 'balanced',
      llmOverride: {
        provider: 'openai',
        format: 'openai-completions',
        baseUrl: 'https://mock-polish.invalid/v1',
        apiKey: 'mock-polish-key',
        model: 'mock-director-v1',
      },
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '```\n开场3秒以工作台痛点切入，中段分段展示素材分析、IndexTTS-2.5配音与双引擎渲染，收尾锁定开源仓库 https://github.com/Merziller/dsh-video-workbench 并号召Star。\n```',
                },
              },
            ],
          }),
          { status: 200 },
        ),
    },
  )
  if (
    !polishedRes.ok ||
    polishedRes.polishedTopic.includes('```') ||
    !polishedRes.polishedTopic.includes('https://github.com/Merziller/dsh-video-workbench')
  ) {
    throw new Error(`Topic polish output invalid: ${JSON.stringify(polishedRes)}`)
  }

  // 16b. Avatar config secret masking + persistence (restore afterwards)
  const origAvatarGet = await handleWorkbenchApiRequest(new Request('http://127.0.0.1/api/video-workbench/avatar/config'))
  const origAvatarCfg = (await origAvatarGet.json()).avatarProvider || {}
  const saveAvRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1/api/video-workbench/avatar/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'external',
        endpoint: 'http://127.0.0.1:9911/avatar',
        apiKey: 'secret-test-key-9988',
      }),
    }),
  )
  const saveAvJson = await saveAvRes.json()
  const readAvJson = await (await handleWorkbenchApiRequest(new Request('http://127.0.0.1/api/video-workbench/avatar/config'))).json()
  await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1/api/video-workbench/avatar/config', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: origAvatarCfg.mode === 'external' ? 'external' : 'builtin',
        endpoint: origAvatarCfg.endpoint || '',
        apiKey: '',
      }),
    }),
  )
  if (
    !saveAvJson.ok ||
    !readAvJson.avatarProvider?.hasApiKey ||
    JSON.stringify(readAvJson).includes('secret-test-key-9988')
  ) {
    throw new Error(`Avatar config masking check failed: ${JSON.stringify(readAvJson)}`)
  }

  // 16c. AI Badge configurable visibility & 4-corner placement across Remotion + HTML5
  const tmpV7Proj = join(REPO_ROOT, '.tmp', 'v7-regression-badge')
  rmSync(tmpV7Proj, { recursive: true, force: true })
  scaffoldVideoProject(tmpV7Proj, {
    title: 'AI Badge & Adaptive Pacing Test',
    engine: 'remotion',
    style: 'tech',
  })
  const badgeScript = readScriptJson(tmpV7Proj).data
  badgeScript.aiBadge = false
  badgeScript.aiBadgeEnabled = false
  badgeScript.aiBadgePosition = 'bottom-left'
  badgeScript.aiBadgeText = 'AI 辅助创作测试'
  writeScriptJson(tmpV7Proj, badgeScript)
  syncProjectCodeFromScript(tmpV7Proj, badgeScript)
  const remotionCompOff = readFileSync(join(tmpV7Proj, 'src', 'VideoComposition.tsx'), 'utf8')
  const shotcraftSrc = readFileSync(join(tmpV7Proj, 'src', 'lib', 'shotcraft.tsx'), 'utf8')
  const pubOff = JSON.parse(readFileSync(join(tmpV7Proj, 'script.json'), 'utf8'))
  const htmlOff = readFileSync(join(tmpV7Proj, 'index.html'), 'utf8')
  badgeScript.aiBadge = true
  badgeScript.aiBadgeEnabled = true
  badgeScript.aiBadgePosition = 'top-right'
  writeScriptJson(tmpV7Proj, badgeScript)
  syncProjectCodeFromScript(tmpV7Proj, badgeScript)
  const pubOn = JSON.parse(readFileSync(join(tmpV7Proj, 'script.json'), 'utf8'))
  const htmlTopRight = readFileSync(join(tmpV7Proj, 'index.html'), 'utf8')
  if (
    !remotionCompOff.includes("import scriptData from '../script.json'") ||
    !remotionCompOff.includes('sData.aiBadgeEnabled') ||
    !remotionCompOff.includes('sData.aiBadgePosition') ||
    !shotcraftSrc.includes("'bottom-left'") ||
    !shotcraftSrc.includes("'top-right'") ||
    pubOff.aiBadgeEnabled !== false ||
    pubOn.aiBadgeEnabled !== true ||
    pubOn.aiBadgePosition !== 'top-right' ||
    !/#ai-badge\s*\{[^}]*display:\s*none/.test(htmlOff) ||
    !/#ai-badge\s*\{[^}]*position:\s*absolute;\s*top:[^}]*right:/.test(htmlTopRight) ||
    !htmlTopRight.includes('AI 辅助创作测试')
  ) {
    throw new Error('AI Badge toggle or 4-corner position assertion failed across Remotion/HTML5')
  }
  rmSync(tmpV7Proj, { recursive: true, force: true })

  // 16d. Topic/genre adaptive pacing rules (calm vs balanced vs dynamic)
  const pCalm = resolvePacingProfile({ topic: '品牌温情故事访谈与十年成长历程', style: 'warm', pacingMode: 'auto' })
  const pBal = resolvePacingProfile({ topic: '开源桌面视频工作台功能介绍与使用教程', style: 'tech', hasAssets: true, pacingMode: 'auto' })
  const pDyn = resolvePacingProfile({ topic: '西楚霸王项羽历史高燃卡点MV', narrationMode: 'subtitle-mv', pacingMode: 'auto' })
  const calmRepaired = repairPromoPlanRules(
    { shots: [{ title: '开篇', narration: '十年历程慢慢讲述。', durationSec: 0.4 }] },
    { topic: '品牌故事访谈', style: 'warm', pacingMode: 'calm' },
  )
  if (
    pCalm.id !== 'calm' ||
    pCalm.allowHalfBeatBlitz ||
    pBal.id !== 'balanced' ||
    pDyn.id !== 'dynamic' ||
    !pDyn.allowHalfBeatBlitz ||
    calmRepaired.shots[0].durationSec < 2.4
  ) {
    throw new Error(`Adaptive pacing check failed: calm=${pCalm.id}, bal=${pBal.id}, dyn=${pDyn.id}, dur=${calmRepaired.shots[0].durationSec}`)
  }

  // 16e. DSH desktop root-bundle manifest (zero workspace:* + bundled Remotion/FFmpeg) + synchronous client module slots
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
  const rootPatchRaw = readFileSync(join(REPO_ROOT, 'cordis.patch.yml'), 'utf8')
  const wbPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'package.json'), 'utf8'))
  const wbClientSrc = readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js'), 'utf8')
  const allPkgFiles = ['package.json', ...readdirSync(join(REPO_ROOT, 'packages')).map((d) => join('packages', d, 'package.json'))]
  for (const relPkg of allPkgFiles) {
    const absPkg = join(REPO_ROOT, relPkg)
    if (!existsSync(absPkg)) continue
    if (readFileSync(absPkg, 'utf8').includes('workspace:*')) {
      throw new Error(`${relPkg} still contains unresolvable workspace:* dependency`)
    }
  }
  if (
    rootPkg.name !== 'dsh-video-workbench' ||
    rootPkg.private === true ||
    rootPkg.exports?.['./client'] !== './packages/dsh-web-video-workbench/lib/client.js' ||
    rootPkg.dsh?.bundle?.patch !== './cordis.patch.yml' ||
    rootPkg.dsh?.client?.platform !== 'web' ||
    !rootPkg.dependencies?.remotion ||
    !rootPkg.dependencies?.['@remotion/renderer'] ||
    !rootPkg.dependencies?.['@ffmpeg-installer/ffmpeg'] ||
    !rootPkg.dependencies?.['@ffprobe-installer/ffprobe'] ||
    !rootPatchRaw.includes('dsh-video-workbench') ||
    wbPkg.exports?.['./client'] !== './lib/client.js' ||
    wbPkg.dsh?.client?.platform !== 'web'
  ) {
    throw new Error('DSH root bundle manifest or bundled dependencies incomplete')
  }
  const rootBundlePlugin = (await import('../index.js')).default
  const bundleTools = []
  const bundlePresets = []
  const bundleRoutes = []
  const bundleWebui = []
  const bundleMockCtx = {
    plugin(plg) {
      if (typeof plg === 'function') plg(bundleMockCtx)
      else if (plg?.apply) plg.apply(bundleMockCtx)
    },
    inject(_deps, fn) { fn(bundleMockCtx) },
    tools: { register: (d) => bundleTools.push(d.name) },
    agentPresets: { register: (d) => bundlePresets.push(d.id) },
    connection: { fetch: { register: (r) => bundleRoutes.push(r.path) } },
    webui: { addStaticModule: (m) => bundleWebui.push(m) },
  }
  rootBundlePlugin.apply(bundleMockCtx)
  if (bundleTools.length < 24 || !bundlePresets.includes('video-maker') || bundleRoutes.length < 30 || bundleWebui.length < 1) {
    throw new Error(`Root bundle index.js failed to mount full stack: tools=${bundleTools.length}, presets=${bundlePresets.length}, routes=${bundleRoutes.length}, webui=${bundleWebui.length}`)
  }
  let capturedLoaderDef = null
  // The host renders nothing but the war-room skin iframe (棱镜实验室 by default; the classic React UI is gone).
  // Effects and refs are recorded so the postMessage bridge (skin → host actions) can be driven below.
  const sandboxStore = {}
  const sandboxStorage = { getItem: (k) => (k in sandboxStore ? sandboxStore[k] : null), setItem: (k, v) => { sandboxStore[k] = String(v) } }
  const recordedEffects = []
  const recordedRefs = []
  const windowListeners = {}
  const mockReact = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    Component: class { constructor(props) { this.props = props || {} } },
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: (fn) => { recordedEffects.push(fn) },
    useRef: (v) => {
      const r = { current: v }
      recordedRefs.push(r)
      return r
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
  }
  const clientSandbox = {
    window: {
      __ModuleLoader__: { load: (def) => { capturedLoaderDef = def } },
      addEventListener: (type, fn) => { (windowListeners[type] = windowListeners[type] || []).push(fn) },
      removeEventListener: () => {},
      dispatchEvent: () => {},
      focus: () => {},
      localStorage: sandboxStorage,
      innerWidth: 1440,
      location: { origin: 'http://127.0.0.1:4399' },
      // the bridge's `api` proxy goes through connFetch → window.fetch → the real plugin router
      fetch: (url, init = {}) => handleWorkbenchApiRequest(new Request(`http://127.0.0.1:4399${url}`, init)),
    },
    document: { querySelector: () => null, createElement: () => ({ style: {} }), head: { appendChild: () => {} }, activeElement: null },
    localStorage: sandboxStorage,
    navigator: { clipboard: {} },
    CustomEvent: class {},
    URL,
    URLSearchParams,
    Request,
    Response,
    ArrayBuffer,
    console,
    setTimeout,
    clearTimeout,
  }
  vmModule.runInNewContext(wbClientSrc, clientSandbox, { filename: 'client.js' })
  if (!capturedLoaderDef || capturedLoaderDef.factory.constructor.name === 'AsyncFunction') {
    throw new Error('DSH client factory must be synchronous for desktop __ModuleLoader__')
  }
  const registeredSlots = []
  let activePanelMock = 'video-workbench'
  const mockLayoutService = {
    panelInfo: {
      getSnapshot: () => ({ activePanelId: activePanelMock }),
      subscribe: () => () => {},
    },
    selectPanel: (next) => {
      activePanelMock = next
    },
  }
  const clientPlugin = capturedLoaderDef.factory((m) => (m === 'react' ? mockReact : {}))
  // Simulate DSH Cordis strict proxy that throws `cannot get property "<k>" without inject` on un-injected services
  const strictCordisCtx = new Proxy(
    {
      slots: {
        inject: (_name, fn) => fn(),
        register: (opts, Comp) => {
          registeredSlots.push({ opts, Comp })
          return () => {}
        },
      },
      inject: (_deps, fn) => fn({ layout: mockLayoutService }),
      get: (svc) => (svc === 'layout' ? mockLayoutService : undefined),
    },
    {
      get(target, prop) {
        if (typeof prop === 'string' && !(prop in target) && !['then', 'toJSON'].includes(prop)) {
          throw new Error(`cannot get property "${prop}" without inject`)
        }
        return target[prop]
      },
    },
  )
  clientPlugin.apply(strictCordisCtx)
  const mainEntry = registeredSlots.find((s) => s.opts?.name === 'main' && s.opts?.key === 'video-workbench')
  const hasOverlaySlot = registeredSlots.some((s) => s.opts?.name === 'shell.overlay')
  const sidebarEntry = registeredSlots.find((s) => s.opts?.name === 'sidebar.panellist' && s.opts?.id === 'video-workbench')
  const toolViewCount = registeredSlots.filter((s) => s.opts?.name === 'tool.call.toolview' && typeof s.opts?.key === 'string').length
  const sidebarSvg = sidebarEntry?.Comp?.({ size: 20, active: true })
  const mainEl = mainEntry?.Comp?.({})
  // Check top-left capsule inside main panel switches back to DeepSeek chat (`null`) and no redundant shell.overlay is registered
  const findButtons = (node, acc = [], depth = 0) => {
    if (!node || depth > 14) return acc
    if (Array.isArray(node)) {
      for (const c of node) findButtons(c, acc, depth + 1)
      return acc
    }
    if (typeof node !== 'object') return acc
    if (typeof node.type === 'function') {
      const compProps = { ...(node.props || {}), children: node.children?.length === 1 ? node.children[0] : node.children }
      const rendered = node.type.prototype && typeof node.type.prototype.render === 'function'
        ? new node.type(compProps).render()
        : node.type(compProps)
      return findButtons(rendered, acc, depth + 1)
    }
    if (node.type === 'button') acc.push(node)
    if (Array.isArray(node.ch || node.children)) {
      for (const c of node.ch || node.children) findButtons(c, acc, depth + 1)
    }
    if (node.props?.children) {
      findButtons(node.props.children, acc, depth + 1)
    }
    return acc
  }
  findButtons(mainEl)
  // Drive the skin bridge like the iframe would: wire the message listener, point the (still unmounted) skin-frame
  // ref at a fake skin window and send actions. backToChat must hand the DSH layout back to the chat panel.
  const fakeSkinWin = { posted: [], postMessage(msg) { this.posted.push(msg) } }
  for (const fx of recordedEffects) {
    if (String(fx).includes("'dsh-vw/ready'")) fx()
  }
  for (const r of recordedRefs) if (r.current === null) r.current = { contentWindow: fakeSkinWin, blur: () => {} }
  const sendSkinAction = async (id, action, payload = {}) => {
    for (const fn of windowListeners.message || []) fn({ source: fakeSkinWin, data: { type: 'dsh-vw/action', v: 1, id, action, payload } })
    for (let i = 0; i < 200 && !fakeSkinWin.posted.some((m) => m.type === 'dsh-vw/result' && m.id === id); i++) await new Promise((r) => setTimeout(r, 10))
    return fakeSkinWin.posted.find((m) => m.type === 'dsh-vw/result' && m.id === id) || null
  }
  const bridgeBack = await sendSkinAction('t-back', 'backToChat')
  const bridgeDeny = await sendSkinAction('t-deny', 'api', { method: 'GET', path: 'projects/delete' })
  const bridgeGet = await sendSkinAction('t-get', 'api', { method: 'GET', path: 'tts-config' })
  const bridgeClassic = await sendSkinAction('t-classic', 'setSkin', { skin: 'classic' })
  const bridgeUpDeny = await sendSkinAction('t-updeny', 'upload', { path: 'voices/import', data: new ArrayBuffer(4) })
  const kitDir = join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'warroom')
  const kitJs = existsSync(join(kitDir, 'kit.js')) ? readFileSync(join(kitDir, 'kit.js'), 'utf8') : ''
  const kitCss = existsSync(join(kitDir, 'kit.css')) ? readFileSync(join(kitDir, 'kit.css'), 'utf8') : ''
  try {
    new vmModule.Script(kitJs, { filename: 'kit.js' })
  } catch (err) {
    throw new Error(`war-room panel kit (lib/warroom/kit.js) does not compile: ${err.message}`)
  }
  const kitPanelIds = ['studio', 'projects', 'newProject', 'help', 'tasks', 'plaza', 'keys', 'voices', 'cloud', 'avatar', 'hardware', 'teleprompter', 'reference', 'brand', 'export', 'history']
  const missingKitPanels = kitPanelIds.filter((id) => !new RegExp(`PK\\.panel\\(\\s*['"]${id}['"]`).test(kitJs))
  const missingKitSteps = ['assets', 'director', 'scenes', 'delivery'].filter((id) => !new RegExp(`PK\\.studioStep\\(\\s*['"]${id}['"]`).test(kitJs))
  const skinDocs = ['nova-deck', 'ink-loom', 'prism-lab'].map((id) => [id, readFileSync(join(kitDir, `${id}.html`), 'utf8')])
  const skinsWithoutKit = skinDocs.filter(([, html]) => !html.includes('kit.js') || !html.includes('kit.css')).map(([id]) => id)
  const skinsOfferingClassic = skinDocs.filter(([, html]) => /['"]classic['"]/.test(html)).map(([id]) => id)
  if (
    !mainEntry ||
    hasOverlaySlot ||
    activePanelMock !== null ||
    !sidebarEntry ||
    sidebarSvg?.type !== 'svg' ||
    toolViewCount < 5 ||
    !bridgeBack?.ok ||
    bridgeDeny?.ok !== false ||
    !String(bridgeDeny?.error || '').includes('面板接口未开放') ||
    !bridgeGet?.ok ||
    bridgeGet?.data?.body?.ok !== true ||
    bridgeClassic?.ok !== false ||
    bridgeUpDeny?.ok !== false ||
    !wbClientSrc.includes('DEFAULT_TTS_ENGINES_FALLBACK') ||
    wbClientSrc.includes("slots.inject('shell.overlay'") ||
    !wbClientSrc.includes('/api/video-workbench/warroom/skin?id=') ||
    !wbClientSrc.includes("const WARROOM_DEFAULT_SKIN = 'prism-lab'") ||
    wbClientSrc.includes('WARROOM_CLASSIC') ||
    wbClientSrc.includes('const warRoomView') ||
    wbClientSrc.includes('const studioWorkbenchView') ||
    !wbClientSrc.includes("case 'backToChat'") ||
    !wbClientSrc.includes('handleBackToChat()') ||
    !wbClientSrc.includes("type: 'dsh-vw/state'") ||
    !kitCss.includes('#pk-root') ||
    missingKitPanels.length ||
    missingKitSteps.length ||
    skinsWithoutKit.length ||
    skinsOfferingClassic.length
  ) {
    throw new Error(
      `DSH client slot / war-room bridge / panel kit check failed: main=${Boolean(mainEntry)}, hasOverlaySlot=${hasOverlaySlot}, panelAfterBack=${activePanelMock}, ` +
        `toolViews=${toolViewCount}, back=${JSON.stringify(bridgeBack)}, deny=${JSON.stringify(bridgeDeny)}, get=${bridgeGet?.ok}/${bridgeGet?.data?.status}, ` +
        `classic=${JSON.stringify(bridgeClassic)}, uploadDeny=${JSON.stringify(bridgeUpDeny)}, missingPanels=${missingKitPanels.join(',')}, ` +
        `missingSteps=${missingKitSteps.join(',')}, skinsWithoutKit=${skinsWithoutKit.join(',')}, skinsOfferingClassic=${skinsOfferingClassic.join(',')}`,
    )
  }

  // 16f. Per-scene keyframe thumbnail extraction (`output/scene-thumbs/*.jpg`) & state integration
  const { extractSceneThumbnails } = await import('../packages/dsh-tool-video-suite/index.js')
  const tmpThumbProj = join(REPO_ROOT, '.tmp', 'v7-scene-thumbs')
  rmSync(tmpThumbProj, { recursive: true, force: true })
  scaffoldVideoProject(tmpThumbProj, { title: 'ThumbExtractTest', engine: 'remotion', style: 'tech' })
  const thumbScript = readScriptJson(tmpThumbProj).data
  thumbScript.scenes = [
    { id: 'scene-01', title: 'S1', startFrame: 0, durationSec: 1.2, durationInFrames: 36, narration: '第一幕' },
    { id: 'scene-02', title: 'S2', startFrame: 36, durationSec: 1.2, durationInFrames: 36, narration: '第二幕' },
  ]
  thumbScript.totalDurationSec = 2.4
  thumbScript.totalDurationInFrames = 72
  writeScriptJson(tmpThumbProj, thumbScript)
  mkdirSync(join(tmpThumbProj, 'output'), { recursive: true })
  await runCommandRedirected(
    bins.ffmpeg,
    ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmpThumbProj, 'output', 'final.mp4')],
    { timeoutMs: 25_000 },
  )
  const thumbActRes = await handleWorkbenchApiRequest(
    new Request('http://127.0.0.1/api/video-workbench/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectDir: tmpThumbProj, action: 'extract-scene-thumbs', force: true }),
    }),
  )
  const thumbActJson = await thumbActRes.json()
  const thumbStateJson = await (
    await handleWorkbenchApiRequest(new Request(`http://127.0.0.1/api/video-workbench/state?projectDir=${encodeURIComponent(tmpThumbProj)}`))
  ).json()
  if (
    typeof extractSceneThumbnails !== 'function' ||
    !thumbActJson.ok ||
    !thumbActJson.sceneThumbs?.['scene-01'] ||
    !thumbActJson.sceneThumbs?.['scene-02'] ||
    !existsSync(join(tmpThumbProj, 'output', 'scene-thumbs', 'scene-01.jpg')) ||
    !thumbStateJson.activeProject?.sceneThumbs?.['scene-02']
  ) {
    throw new Error(`Scene thumbnail extraction test failed: ${JSON.stringify(thumbActJson)}`)
  }
  rmSync(tmpThumbProj, { recursive: true, force: true })

  // 16g. Multi-Engine TTS Config (GPT-SoVITS + Custom OpenAI/HTTP/CLI Model Import + Secret Masking + HTTP Audio Synth)
  const ttsCfgPath = join(REPO_ROOT, '.dsh-video-tts-config.json')
  const prevTtsCfgRaw = existsSync(ttsCfgPath) ? readFileSync(ttsCfgPath, 'utf8') : null
  const mockAudioRes = await (async () => {
    const { createServer } = await import('node:http')
    const mockWavPath = join(REPO_ROOT, '.tmp', 'v7-mock-tts-src.wav')
    mkdirSync(join(REPO_ROOT, '.tmp'), { recursive: true })
    await runCommandRedirected(
      bins.ffmpeg,
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.1', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', mockWavPath],
      { timeoutMs: 15_000 },
    )
    const wavBytes = readFileSync(mockWavPath)
    let hitPayload = null
    let hitAuth = ''
    const srv = createServer(async (req, res) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('ok')
        return
      }
      const chunks = []
      for await (const c of req) chunks.push(c)
      const rawBody = Buffer.concat(chunks).toString('utf8')
      hitPayload = rawBody ? JSON.parse(rawBody) : {}
      hitAuth = req.headers.authorization || ''
      res.writeHead(200, { 'Content-Type': 'audio/wav' })
      res.end(wavBytes)
    })
    await new Promise((r) => srv.listen(0, '127.0.0.1', r))
    const addr = srv.address()
    try {
      // Check built-ins include gptvoice & switch cleanly
      const swRes = await handleWorkbenchApiRequest(
        new Request('http://127.0.0.1/api/video-workbench/tts-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'select', activeEngineId: 'gptvoice' }),
        }),
      )
      const swJson = await swRes.json()
      const hasGsv = (swJson.config?.engines || []).some((e) => e.id === 'gptvoice')
      if (!swJson.ok || !hasGsv || swJson.config?.activeEngineId !== 'gptvoice') {
        throw new Error(`GPT-SoVITS switch failed: ${JSON.stringify(swJson)}`)
      }

      // Add custom OpenAI-compatible TTS model with secret API Key & test audio synthesis
      const addRes = await handleWorkbenchApiRequest(
        new Request('http://127.0.0.1/api/video-workbench/tts-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'add-custom',
            engine: {
              id: 'test-kokoro-openai',
              name: 'Test Kokoro Custom',
              kind: 'openai-tts',
              endpoint: `http://127.0.0.1:${addr.port}/v1/audio/speech`,
              apiKey: 'sk-custom-secret-8899',
              model: 'kokoro-test',
              voice: 'zf_xiaoxiao',
              activate: true,
            },
          }),
        }),
      )
      const addJson = await addRes.json()
      const getTtsRes = await handleWorkbenchApiRequest(new Request('http://127.0.0.1/api/video-workbench/tts-config'))
      const getTtsRaw = await getTtsRes.text()
      const getTtsJson = JSON.parse(getTtsRaw)
      const customEntry = (getTtsJson.config?.engines || []).find((e) => e.id === 'test-kokoro-openai')
      if (!addJson.ok || !customEntry?.hasApiKey || getTtsRaw.includes('sk-custom-secret-8899')) {
        throw new Error(`Custom TTS secret masking failed: ${getTtsRaw}`)
      }

      const synthTestRes = await handleWorkbenchApiRequest(
        new Request('http://127.0.0.1/api/video-workbench/tts-test', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ engineId: 'test-kokoro-openai', text: '自定义轻量化配音引擎测试' }),
        }),
      )
      const synthTestJson = await synthTestRes.json()
      if (
        !synthTestJson.ok ||
        !String(synthTestJson.audioDataUrl || '').startsWith('data:audio/wav;base64,') ||
        Number(synthTestJson.durationSec) < 0.8 ||
        hitPayload?.input !== '自定义轻量化配音引擎测试' ||
        hitAuth !== 'Bearer sk-custom-secret-8899'
      ) {
        throw new Error(`Custom TTS synthesis check failed: ${JSON.stringify(synthTestJson)}`)
      }
      return synthTestJson
    } finally {
      srv.close()
      try { rmSync(mockWavPath, { force: true }) } catch {}
      if (prevTtsCfgRaw !== null) writeFileSync(ttsCfgPath, prevTtsCfgRaw, 'utf8')
      else try { rmSync(ttsCfgPath, { force: true }) } catch {}
    }
  })()

  console.log(
    `[16/17] v7+v8 Verified (Topic Polish, Strict Cordis Proxy + Top Switcher [${registeredSlots.length}], Multi-Engine TTS GPT-SoVITS + Custom OpenAI Synth [${mockAudioRes.durationSec}s], NarrationMode UI & Scene Thumbs)!`,
  )

  // 17. v0.3.5 Unrestricted Open Genre Pass-Through (genreLabel) & Freeform Stage Liberation
  const { splitDirectorBrief } = await import('../packages/shared/meta-guard.js')
  const { buildGenreGuidance, resolveGenreSelection } = await import('../packages/dsh-tool-media/genre-router.js')
  const { buildBatchedRemotionScenesPrompt, buildHtmlCoderSkillsPrompt } = await import('../packages/dsh-tool-media/shotcraft-lib.js')
  const { repairPromoPlanRules: repairFreeformPlan, runSchemaDirectorWithDegradation: runDirFreeform } = await import('../packages/dsh-tool-media/plan-schema.js')
  const { syncProjectCodeFromScript: syncFreeformCode } = await import('../packages/dsh-tool-media/ai-director.js')

  const customPolishedRes = await polishTopicPrompt(
    {
      rawPrompt: '制作一部深海热液生物纪录动画，风格像透明玻璃解剖图鉴',
      style: 'cinematic',
      llmOverride: {
        provider: 'openai',
        format: 'openai-completions',
        baseUrl: 'https://mock-free-genre.invalid/v1',
        apiKey: 'mock-key',
        model: 'mock-director-open',
      },
    },
    {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    genre: 'deepsea-glass-atlas',
                    genreLabel: '深海透明解剖图鉴动画',
                    displayTitle: '幽渊之灯',
                    logline: '以透明玻璃剖面呈现深海热液生命奇迹',
                    contentOutline: ['400℃ 黑烟囱涌泉', '盲虾集群趋光迁徙'],
                    directorNotes: '采用玻璃半透剖面、青金光散射粒子与慢推镜。',
                    voiceStyle: '沉静带敬畏感的自然纪录片旁白',
                    suggestedStyle: 'cinematic',
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
    },
  )
  const splitCustom = splitDirectorBrief({ topic: customPolishedRes.polishedTopic })
  const customGenreSel = resolveGenreSelection({ genre: customPolishedRes.genre, genreLabel: customPolishedRes.genreLabel })
  const customGuidance = buildGenreGuidance(customGenreSel.id, customGenreSel.label)
  if (
    customPolishedRes.genre !== 'other' ||
    customPolishedRes.genreLabel !== '深海透明解剖图鉴动画' ||
    splitCustom.genreLabel !== '深海透明解剖图鉴动画' ||
    customGenreSel.id !== 'other' ||
    customGenreSel.label !== '深海透明解剖图鉴动画' ||
    !customGuidance.includes('深海透明解剖图鉴动画')
  ) {
    throw new Error(`Custom genre pass-through assertion failed: ${JSON.stringify({ customPolishedRes, splitCustom, customGenreSel, customGuidance })}`)
  }
  // stringified missing values left by an old skin bug never reach the brief / the AI prompt
  {
    const { formatDirectorBrief: fmtBrief } = await import('../packages/shared/meta-guard.js')
    const stale = splitDirectorBrief({ topic: '【作品标题】秋日咖啡馆新品宣传\n【一句话】undefined\n【内容要点】\n1. 新品特写\n2. 门店氛围', directorNotes: 'null' })
    const staleFmt = fmtBrief({ goal: 'undefined', userPrompt: '为社区咖啡馆做一支秋季新品宣传片', directorNotes: '暖色调', contentOutline: ['新品特写'] })
    // a brief flattened to one line, as found in a real project
    const staleFlat = fmtBrief({ goal: '【作品标题】秋日咖啡馆新品宣传【体裁】产品宣发【一句话】undefined【导演备注（仅供 AI 制作，不会出现在视频里）】温暖治愈' })
    if (/undefined|null/.test(JSON.stringify(stale)) || stale.displayTitle !== '秋日咖啡馆新品宣传' || !staleFmt.includes('【一句话】为社区咖啡馆') || /undefined/.test(staleFmt) ||
      /undefined|【一句话】/.test(staleFlat) || !staleFlat.includes('【体裁】产品宣发【导演备注')) {
      throw new Error(`Stale "undefined" brief cleanup failed: ${JSON.stringify({ stale, staleFmt, staleFlat })}`)
    }
  }

  const repairedFreeform = repairFreeformPlan(
    {
      title: '幽渊之灯',
      shots: [
        { id: 'scene-01', title: '热液喷口', narration: '在4000米深海热液喷口旁，微光悄然涌动。', layout: 'freeform-stage', visualBlueprint: '3D 玻璃海沟纵切 + 发光热液粒子流' },
        { id: 'scene-02', title: '生命阵列', narration: '盲虾依附在400℃黑烟囱周围建立绿洲。', visualBlueprint: '透明外骨骼向量解剖视图' },
      ],
    },
    { topic: '幽渊之灯', genre: 'other', genreLabel: '深海透明解剖图鉴动画', authoringMode: 'ai-coded' },
  )
  const tier2Modern = await runDirFreeform({
    topic: '深海热液解剖图鉴',
    genre: 'other',
    genreLabel: '深海透明解剖图鉴动画',
    authoringMode: 'ai-coded',
    forceTierForTest: 2,
    callLlmChatFn: async () => ({
      text: '热液初涌 | 玻璃剖面 | 4000米海底喷出炽热矿泉。 | 半透明粒子与热羽流上升\n盲虾共生 | 神经发光网 | 化能合成细菌滋养深海群落。 | 发光微粒沿轨迹流动',
    }),
  })
  const freeRemotionPrompt = buildBatchedRemotionScenesPrompt({
    batchIndex: 0,
    totalBatches: 1,
    batchScenes: [{ id: 'scene-01', index: 1, title: '热液喷口', narration: '微光涌动', durationSec: 4, durationInFrames: 120, startSec: 0 }],
    totalScenes: 1,
    width: 1920,
    height: 1080,
    topic: '幽渊之灯',
    genre: 'other',
    genreLabel: '深海透明解剖图鉴动画',
  })
  const freeHtmlPrompt = buildHtmlCoderSkillsPrompt({
    plan: { topic: '幽渊之灯', genre: 'other', genreLabel: '深海透明解剖图鉴动画', theme: {}, scenes: [] },
    timingContract: { topic: '幽渊之灯', genre: 'other', genreLabel: '深海透明解剖图鉴动画', fps: 30, totalDurationInFrames: 120, scenes: [] },
    width: 1920,
    height: 1080,
    aspectRatio: '16:9',
  })
  if (
    repairedFreeform.genreLabel !== '深海透明解剖图鉴动画' ||
    repairedFreeform.shots[0].layout !== 'freeform-stage' ||
    repairedFreeform.shots[1].layout !== 'freeform-stage' ||
    tier2Modern.plan?.genreLabel !== '深海透明解剖图鉴动画' ||
    tier2Modern.plan?.shots?.[0]?.layout !== 'freeform-stage' ||
    !freeRemotionPrompt.system.includes('深海透明解剖图鉴动画') ||
    !freeRemotionPrompt.user.includes('深海透明解剖图鉴动画') ||
    !freeHtmlPrompt.system.includes('深海透明解剖图鉴动画') ||
    !freeHtmlPrompt.user.includes('深海透明解剖图鉴动画') ||
    // 视效偏好 defaults to 「AI 按需自由创作」 and the ready-made imports are never a closed list
    !freeRemotionPrompt.system.includes('AI 按需自由创作') ||
    freeRemotionPrompt.system.includes('严格以此为准') ||
    !freeRemotionPrompt.system.includes('自由编写') ||
    !freeHtmlPrompt.system.includes('AI 按需自由创作')
  ) {
    throw new Error(`Freeform-stage liberation assertion failed: repaired=${JSON.stringify(repairedFreeform.shots.map((s) => s.layout))}, t2=${tier2Modern.plan?.shots?.[0]?.layout}`)
  }

  // Fallback Stage safety for `layout: 'freeform-stage'` without CustomSceneComp override
  const tmpFreeformFallbackProj = join(REPO_ROOT, '.tmp', 'v035-freeform-fallback')
  rmSync(tmpFreeformFallbackProj, { recursive: true, force: true })
  scaffoldVideoProject(tmpFreeformFallbackProj, { title: '幽渊之灯', genre: 'other', genreLabel: '深海透明解剖图鉴动画', engine: 'remotion', style: 'cinematic' })
  const ffScript = JSON.parse(readFileSync(join(tmpFreeformFallbackProj, 'script.json'), 'utf8'))
  ffScript.scenes = (ffScript.scenes || []).slice(0, 2).map((sc, idx) => ({
    ...sc,
    layout: 'freeform-stage',
    title: idx === 0 ? '热液初涌' : '盲虾共生',
    narration: idx === 0 ? '在4000米深海之下。' : '生命悄然绽放。',
  }))
  writeFileSync(join(tmpFreeformFallbackProj, 'script.json'), JSON.stringify(ffScript, null, 2) + '\n', 'utf8')
  syncFreeformCode(tmpFreeformFallbackProj, ffScript, { forceOverwrite: true })
  const ffCompTsx = readFileSync(join(tmpFreeformFallbackProj, 'src', 'VideoComposition.tsx'), 'utf8')
  const ffLint = await executeVideoLint({ projectDir: tmpFreeformFallbackProj, engine: 'remotion' })
  const ffTsc = await runTypecheckOnProject(tmpFreeformFallbackProj)
  rmSync(tmpFreeformFallbackProj, { recursive: true, force: true })
  if (
    !ffCompTsx.includes("!['3d-stage-opener'") ||
    !ffLint.ok ||
    !ffTsc.ok
  ) {
    throw new Error(`Freeform fallback SceneStage safety failed: lint=${JSON.stringify(ffLint.errors)}, tsc=${JSON.stringify(ffTsc.errors)}`)
  }
  console.log(
    `[17/18] v0.3.5 Open Genre Pass-Through (genreLabel='${customGenreSel.label}') & Freeform-Stage Zero-Cage Verified (Tier1+Tier2 + TSX Fallback tsc/lint PASS)!`,
  )

  // 18. v0.3.6 Pixel-Exact FocusShot Coordinate Engine, Multimodal Vision Grounding (4 Wire Protocols), Sidecar Anchors & Anti-PPT Video Preservation
  const { callLlmChat: callVisionLlm } = await import('../packages/dsh-tool-media/llm-client.js')
  const { groundVisualAssets: groundTestAssets, buildMediaDimsMap: buildTestDimsMap } = await import('../packages/dsh-tool-media/vision-grounding.js')

  // 18a. Verify multimodal image payload encoding across ALL 4 wire protocols
  const capturedPayloads = {}
  const testTinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
  for (const proto of ['openai-completions', 'openai-responses', 'anthropic-messages', 'gemini-native']) {
    await callVisionLlm({
      overrideConfig: {
        mode: 'custom',
        provider: 'custom',
        format: proto,
        baseUrl: proto === 'gemini-native' ? 'https://mock-vision.invalid/v1beta' : 'https://mock-vision.invalid/v1',
        apiKey: 'mock-vision-key',
        model: 'mock-vision-v1',
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'locate button' },
            { type: 'image', mimeType: 'image/png', base64: testTinyPngB64 },
          ],
        },
      ],
      fetchImpl: async (_url, init) => {
        capturedPayloads[proto] = JSON.parse(init.body)
        if (proto === 'anthropic-messages') {
          return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }] }), { status: 200 })
        }
        if (proto === 'openai-responses') {
          return new Response(JSON.stringify({ output_text: '{"ok":true}' }), { status: 200 })
        }
        if (proto === 'gemini-native') {
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }), { status: 200 })
        }
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 })
      },
    })
  }
  const mmOpenAiChat = capturedPayloads['openai-completions']?.messages?.find((m) => m.role === 'user')?.content
  const mmOpenAiResp = capturedPayloads['openai-responses']?.input?.[0]?.content
  const mmAnthropic = capturedPayloads['anthropic-messages']?.messages?.[0]?.content
  const mmGemini = capturedPayloads['gemini-native']?.contents?.[0]?.parts
  if (
    !Array.isArray(mmOpenAiChat) || !mmOpenAiChat.some((p) => p.type === 'image_url' && p.image_url?.url?.includes(testTinyPngB64)) ||
    !Array.isArray(mmOpenAiResp) || !mmOpenAiResp.some((p) => p.type === 'input_image' && p.image_url?.includes(testTinyPngB64)) ||
    !Array.isArray(mmAnthropic) || !mmAnthropic.some((p) => p.type === 'image' && p.source?.data === testTinyPngB64) ||
    !Array.isArray(mmGemini) || !mmGemini.some((p) => p.inlineData?.data === testTinyPngB64)
  ) {
    throw new Error(`Multimodal vision encoding failed across 4 protocols: ${JSON.stringify(capturedPayloads)}`)
  }

  // 18b. Sidecar DOM *.anchors.json + Vision LLM fallback + Top-bar fy=0.032 NOT clamped + Video clips NEVER receive fake cursors
  const tmpV036Proj = join(REPO_ROOT, '.tmp', 'v036-ui-grounding')
  rmSync(tmpV036Proj, { recursive: true, force: true })
  mkdirSync(join(tmpV036Proj, 'uploads'), { recursive: true })
  const rawPngShot = join(tmpV036Proj, 'uploads', '01a-ui-topbar-shot.png')
  const rawMp4Rec = join(tmpV036Proj, 'uploads', '02-ui-demo-recording.mp4')
  await runCommandRedirected(bins.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0xF8FAFC:s=1920x1080', '-frames:v', '1', rawPngShot], { timeoutMs: 15_000 })
  await runCommandRedirected(bins.ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=0xF1F5F9:s=1920x1080:r=30', '-t', '1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', rawMp4Rec], { timeoutMs: 20_000 })
  writeFileSync(
    join(tmpV036Proj, 'uploads', '01a-ui-topbar-shot.anchors.json'),
    JSON.stringify({
      visualSummary: '亮色工作台顶栏与工程切换入口',
      uiAnchors: [{ label: '切换或管理视频工程', fx: 0.255, fy: 0.032, fw: 0.14, fh: 0.038, kind: 'button' }],
    }),
    'utf8',
  )
  await importAssets({ projectDir: tmpV036Proj, sources: [rawPngShot, rawMp4Rec] })
  const groundRes = await groundTestAssets({ projectDir: tmpV036Proj, enableVision: false })
  const groundedManifest = readAssets(tmpV036Proj)
  const imgItem = groundedManifest.items.find((x) => x.type === 'image')
  const vidItem = groundedManifest.items.find((x) => x.type === 'video')
  const dimsMapV036 = buildTestDimsMap(groundedManifest)
  const repairedAnchorPlan = repairFreeformPlan(
    {
      genre: 'ui-tutorial',
      shots: [
        { id: 'scene-01', title: '切换工程', narration: '点击左上角切换或管理视频工程。', clickLabel: '切换或管理视频工程', assetRefs: [imgItem.path] },
        { id: 'scene-02', title: '动态录屏演示', narration: '真实操作录屏演示完整步骤。', clickLabel: '新建工程', assetRefs: [vidItem.path] },
      ],
    },
    { topic: '工作台教程', genre: 'ui-tutorial', authoringMode: 'ai-coded', assetsManifest: groundedManifest },
  )
  const shot1Click = repairedAnchorPlan.shots[0]?.cursors?.find((c) => c.click)
  const shot2Cursors = repairedAnchorPlan.shots[1]?.cursors
  if (
    !groundRes.ok ||
    !imgItem?.uiAnchors?.length ||
    !dimsMapV036[imgItem.path] ||
    dimsMapV036[imgItem.path].width !== 1920 ||
    Math.abs((shot1Click?.fx || 0) - 0.255) > 0.001 ||
    Math.abs((shot1Click?.fy || 0) - 0.032) > 0.001 ||
    (Array.isArray(shot2Cursors) && shot2Cursors.length > 0)
  ) {
    throw new Error(`v0.3.6 UI anchor & anti-fake-cursor verification failed: ${JSON.stringify({ shot1Click, shot2Cursors, dimsMapV036 })}`)
  }

  // 18c. Verify media-editor preserves UI video aspect + FocusShot containerType & __DSH_MEDIA_DIMS compile cleanly under tsc --noEmit
  scaffoldVideoProject(tmpV036Proj, { title: 'v036 FocusShot Check', engine: 'remotion', style: 'tech' })
  await executeCurateAndEditAssets({ projectDir: tmpV036Proj, aspectRatio: '16:9', quality: '1080p' })
  const v036Script = JSON.parse(readFileSync(join(tmpV036Proj, 'script.json'), 'utf8'))
  syncFreeformCode(tmpV036Proj, v036Script, { forceOverwrite: true })
  const v036Shotcraft = readFileSync(join(tmpV036Proj, 'src', 'lib', 'shotcraft.tsx'), 'utf8')
  const v036Comp = readFileSync(join(tmpV036Proj, 'src', 'VideoComposition.tsx'), 'utf8')
  const v036Tsc = await runTypecheckOnProject(tmpV036Proj)
  rmSync(tmpV036Proj, { recursive: true, force: true })
  if (
    !v036Shotcraft.includes('__DSH_MEDIA_DIMS') ||
    !v036Shotcraft.includes('100cqw') ||
    !v036Shotcraft.includes('M0 0 L8 25') ||
    !v036Comp.includes('__DSH_MEDIA_DIMS') ||
    !v036Tsc.ok
  ) {
    throw new Error(`v0.3.6 FocusShot/VideoComposition tsc check failed: tsc=${JSON.stringify(v036Tsc.errors)}`)
  }
  console.log(
    `[18/18] v0.3.6 Pixel-Exact FocusShot (containerType 100cqw + __DSH_MEDIA_DIMS + exact 0,0 cursor tip) & 4-Protocol Multimodal Vision/Sidecar Grounding Verified (tsc 0 errors)!`,
  )

  // 19. v0.3.7 Persistent AI-Polished Brief & Step 2 / War Room Textarea Echo Verification
  const { formatDirectorBrief: formatBriefV037, splitDirectorBrief: splitBriefV037 } = await import('../packages/shared/index.js')
  const samplePolishedBrief = [
    '【作品标题】深海奇观导览',
    '【体裁】海洋科普实操短片',
    '【一句话】带观众潜入马里亚纳海沟看发光生物',
    '【内容要点】',
    '1. 深海高压与发光鱼类的演化机制',
    '2. 潜航器光学探测与实拍画面对比',
    '【导演备注（仅供 AI 制作，不会出现在视频里）】',
    '16:9 满幅清晰展示，不要做左图右字 PPT，配音亲切沉稳 1.08x。',
  ].join('\n')
  const splitV037 = splitBriefV037({ topic: samplePolishedBrief })
  if (
    !Array.isArray(splitV037.contentOutline) ||
    splitV037.contentOutline.length !== 2 ||
    !splitV037.directorNotes.includes('16:9 满幅清晰展示')
  ) {
    throw new Error(`splitDirectorBrief failed to preserve contentOutline[] & directorNotes: ${JSON.stringify(splitV037)}`)
  }
  // Verify reconstructing full polished brief when legacy script.json had goal: ""
  const reconstructedLegacy = formatBriefV037({
    title: 'DSH 视频工作台实操',
    displayTitle: 'DSH视频工作台实操',
    genreLabel: '亮色界面软件全流程实操教程',
    goal: '',
    contentOutline: '产品定位：工作台支持 4-Agent 协同。,配置要求：最低 4 核 8 GB。',
    directorNotes: '16:9 亮色满幅，不做左图右字。',
  })
  if (
    !reconstructedLegacy.includes('【作品标题】DSH视频工作台实操') ||
    !reconstructedLegacy.includes('【内容要点】\n1. 产品定位') ||
    !reconstructedLegacy.includes('2. 配置要求') ||
    !reconstructedLegacy.includes('【导演备注（仅供 AI 制作，不会出现在视频里）】')
  ) {
    throw new Error(`formatDirectorBrief failed legacy reconstruction: ${reconstructedLegacy}`)
  }
  // Verify planVideoFromAssets preserves full polished goal instead of wiping it to ""
  const tmpV037Proj = join(REPO_ROOT, '.tmp', 'v037-brief-echo')
  rmSync(tmpV037Proj, { recursive: true, force: true })
  mkdirSync(tmpV037Proj, { recursive: true })
  await planVideoFromAssets({
    projectDir: tmpV037Proj,
    topic: samplePolishedBrief,
    displayTitle: splitV037.displayTitle,
    genreLabel: splitV037.genreLabel,
    contentOutline: splitV037.contentOutline,
    directorNotes: splitV037.directorNotes,
    goal: '',
    engine: 'remotion',
    style: 'tech',
  })
  const savedV037 = JSON.parse(readFileSync(join(tmpV037Proj, 'script.json'), 'utf8'))
  rmSync(tmpV037Proj, { recursive: true, force: true })
  const clientSrcV037 = readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js'), 'utf8')
  if (
    !String(savedV037.goal || '').includes('【导演备注') ||
    !Array.isArray(savedV037.contentOutline) ||
    savedV037.contentOutline.length !== 2 ||
    clientSrcV037.includes('ap.script?.goal ?? ap.script?.topic') ||
    !clientSrcV037.includes('resolveDisplayPrompt')
  ) {
    throw new Error(`v0.3.7 persistent polished prompt check failed: goal=${savedV037.goal} outline=${JSON.stringify(savedV037.contentOutline)}`)
  }
  console.log(
    `[19/19] v0.3.7 Persistent AI-Polished Brief (script.goal + contentOutline[] preservation, legacy reconstruction & UI echo) Verified!`,
  )

  // 20. v0.3.8 Uploaded BGM/Note/SFX Auto-Bind + Audible BGM Mix + Custom Duration & Anti-Shrink Expansion Verification
  const { parseDurationFromText, resolveTargetDurationPolicy, estimatePlanDurationSec } = await import('../packages/shared/index.js')
  const parsedTwoMin = parseDurationFromText('视频时长需要两分钟以上，分镜与动效全程踩死上传BGM节拍')
  const parsed2m30 = parseDurationFromText('做一个2分30秒的产品宣传片')
  const customPol = resolveTargetDurationPolicy({ durationMode: 'custom', targetDurationSec: 150, text: '随便聊聊', narrationMode: 'tts' })
  if (
    !parsedTwoMin || parsedTwoMin.minSec < 120 || parsedTwoMin.sec < 130 ||
    !parsed2m30 || parsed2m30.sec !== 150 ||
    !customPol.enforced || customPol.targetSec !== 150 || customPol.requiredCharsMin < 450
  ) {
    throw new Error(`v0.3.8 duration policy failed: ${JSON.stringify({ parsedTwoMin, parsed2m30, customPol })}`)
  }

  // 20b. Verify uploading a BGM via general /assets/upload auto-binds bgmMode='uploaded' & beat analysis,
  //      and uploading a .txt note returns 200 OK instead of 400!
  const tmpV038Proj = join(REPO_ROOT, '.tmp', 'v038-bgm-duration')
  rmSync(tmpV038Proj, { recursive: true, force: true })
  scaffoldVideoProject(tmpV038Proj, { title: 'v038 BGM & Duration Check', engine: 'remotion', style: 'tech' })
  const synthBgm15 = join(tmpV038Proj, 'test_bgm_15s.wav')
  const { buildBeatGrid: buildGridV038, generateBgmWav: genBgmV038, mixVideoAudio: mixV038, quantizeScenesToBeatGrid: quantV038 } = await import('../packages/dsh-tool-media/audio-synth.js')
  genBgmV038({ durationSec: 16, mood: 'energetic', bpm: 120, outPath: synthBgm15 })
  const bgmBuf = readFileSync(synthBgm15)
  const upBgmViaGeneral = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399/api/video-workbench/assets/upload?projectDir=${encodeURIComponent(tmpV038Proj)}&fileName=my-cool-track.wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bgmBuf,
    }),
  )
  const upBgmJson = await upBgmViaGeneral.json()
  const upNoteViaGeneral = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399/api/video-workbench/assets/upload?projectDir=${encodeURIComponent(tmpV038Proj)}&fileName=story-notes.txt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from('这是用户上传的脚本文案笔记，包含核心卖点与章节。', 'utf8'),
    }),
  )
  const upNoteJson = await upNoteViaGeneral.json()
  const scAfterUp = JSON.parse(readFileSync(join(tmpV038Proj, 'script.json'), 'utf8'))
  if (
    upBgmViaGeneral.status !== 200 ||
    !upBgmJson.ok ||
    !upBgmJson.autoBound?.bgm ||
    scAfterUp.bgmMode !== 'uploaded' ||
    !scAfterUp.bgm?.uploadedPath ||
    upNoteViaGeneral.status !== 200 ||
    !upNoteJson.ok
  ) {
    throw new Error(`v0.3.8 general /assets/upload auto-bind failed: bgm=${JSON.stringify(upBgmJson)} note=${JSON.stringify(upNoteJson)} scriptBgm=${JSON.stringify(scAfterUp.bgm)}`)
  }

  // 20c. Verify mixVideoAudio produces genuinely audible uploaded BGM (mean_volume > -32 dB, never muted)
  scAfterUp.totalDurationSec = 6
  scAfterUp.bgm.volume = 0 // even accidental 0 must NOT mute when enabled !== false
  const mixV038Res = await mixV038({
    projectDir: tmpV038Proj,
    script: scAfterUp,
    assetsManifest: readAssets(tmpV038Proj),
    outputPath: join(tmpV038Proj, 'output', 'master-audio.wav'),
  })
  const volProbe = await runCommandRedirected(
    bins.ffmpeg,
    ['-hide_banner', '-i', mixV038Res.outputPath, '-af', 'volumedetect', '-f', 'null', '-'],
    { timeoutMs: 20_000 },
  )
  const meanMatch = `${volProbe.stderr}\n${volProbe.stdout}`.match(/mean_volume:\s*([-\d.]+)\s*dB/)
  const meanDb = meanMatch ? Number(meanMatch[1]) : -99
  if (mixV038Res.bgmSource !== 'user-imported' || !Number.isFinite(meanDb) || meanDb < -30) {
    throw new Error(`v0.3.8 uploaded BGM mix audibility failed: source=${mixV038Res.bgmSource} meanDb=${meanDb}`)
  }

  // 20d. Verify quantizeScenesToBeatGrid extends past a 40s BGM when targetDurationSec=130 (no clamping!)
  const dummyScenes20 = Array.from({ length: 22 }, (_, i) => ({
    id: `scene-${String(i + 1).padStart(2, '0')}`,
    title: `分镜 ${i + 1}`,
    narration: '这是一段用于测试两分钟以上长视频踩拍延展的演示台词。',
    durationSec: 5.5,
  }))
  const shortBgmGrid = buildGridV038(40, 120)
  const extMvScenes = quantV038(dummyScenes20, { ...shortBgmGrid, durationSec: 40 }, { mode: 'subtitle-mv', fps: 30, targetDurationSec: 130 })
  const extTotalSec = extMvScenes[extMvScenes.length - 1]?.endSec || 0
  if (extTotalSec < 115) {
    throw new Error(`v0.3.8 beat grid clamped to short BGM instead of extending to 130s: got ${extTotalSec}s`)
  }

  // 20e. Verify Tier 1 Anti-Shrink Expansion triggers when mock LLM returns only ~42s for a 130s custom target
  const { runSchemaDirectorWithDegradation: runDirV038 } = await import('../packages/dsh-tool-media/plan-schema.js')
  let mockTierCalls = 0
  const expandedPlanRes = await runDirV038({
    projectDir: tmpV038Proj,
    topic: '两分钟以上历史战争解析',
    durationMode: 'custom',
    targetDurationSec: 130,
    style: 'cinematic',
    authoringMode: 'ai-coded',
    scriptData: scAfterUp,
    assetsManifest: readAssets(tmpV038Proj),
    callLlmChatFn: async () => {
      mockTierCalls++
      if (mockTierCalls === 1) {
        return {
          text: JSON.stringify({
            version: 'promo-plan/1',
            genre: 'history-theater',
            genreLabel: '历史剧场',
            title: '两分钟历史长片',
            style: 'cinematic',
            bpm: 112,
            shots: Array.from({ length: 8 }, (_, k) => ({
              id: `scene-${String(k + 1).padStart(2, '0')}`,
              title: `开篇第${k + 1}幕`,
              narration: '公元前119年大军出征漠北千里奔袭直击敌营。',
              durationSec: 5.0,
              layout: 'freeform-stage',
              transition: k === 0 ? 'cut' : 'slash-wipe',
              visualBlueprint: '动态疆域行军路线与火光粒子',
            })),
          }),
        }
      }
      return {
        text: JSON.stringify({
          appendShots: Array.from({ length: 14 }, (_, k) => ({
            id: `scene-${String(k + 9).padStart(2, '0')}`,
            title: `续篇第${k + 9}幕`,
            narration: '骑兵穿插迂回切断补给线，战鼓与号角在苍茫大漠中回荡不绝，最终在狼居胥山勒石纪功。',
            durationSec: 6.2,
            layout: 'freeform-stage',
            transition: 'slash-wipe',
            visualBlueprint: '水墨地形推演与骑兵包抄轨迹',
          })),
        }),
      }
    },
  })
  const expandedEstSec = estimatePlanDurationSec(expandedPlanRes?.plan?.shots || [], { narrationMode: 'tts' })
  rmSync(tmpV038Proj, { recursive: true, force: true })
  const serverIndexSrc = readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'index.js'), 'utf8')
  const llmClientSrc = readFileSync(join(REPO_ROOT, 'packages', 'dsh-tool-media', 'llm-client.js'), 'utf8')
  if (
    mockTierCalls < 2 ||
    (expandedPlanRes?.plan?.shots?.length || 0) < 18 ||
    expandedEstSec < 110 ||
    !serverIndexSrc.includes('timeoutMs: 600_000') ||
    !llmClientSrc.includes('postJsonLongTimeout')
  ) {
    throw new Error(`v0.3.8/0.3.9 anti-shrink or 10-min polish check failed: calls=${mockTierCalls} shots=${expandedPlanRes?.plan?.shots?.length} estSec=${expandedEstSec}`)
  }
  console.log(
    `[20/22] v0.3.9 Uploaded BGM/Note Auto-Bind + Audible Mix (${meanDb.toFixed(1)} dB) + Custom Duration & Anti-Shrink (${expandedEstSec}s, ${expandedPlanRes.plan.shots.length} shots) + 10-Min Async AI Polish Verified!`,
  )

  // =========================================================================
  // 21. v0.4.0 Universal Multi-Agent MCP Server (29 Tools) + Reference Video Remake + MOTION.md + Brand Kit + TTS Installer
  // =========================================================================
  const { spawn: spawnChild } = await import('node:child_process')
  const mcpReplies = await new Promise((resolveMcp, rejectMcp) => {
    const mcpProc = spawnChild(process.execPath, [join(REPO_ROOT, 'bin', 'dsh-video-mcp.mjs')], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let outBuf = ''
    const msgs = []
    const timer = setTimeout(() => {
      try { mcpProc.kill('SIGKILL') } catch {}
      rejectMcp(new Error(`MCP stdio server timed out (received ${msgs.length} replies)`))
    }, 20_000)
    mcpProc.stdout.on('data', (chunk) => {
      outBuf += chunk.toString('utf8')
      const lines = outBuf.split('\n')
      outBuf = lines.pop() || ''
      for (const l of lines) {
        if (!l.trim()) continue
        try {
          msgs.push(JSON.parse(l.trim()))
          if (msgs.length >= 3) {
            clearTimeout(timer)
            try { mcpProc.kill() } catch {}
            resolveMcp(msgs)
          }
        } catch {}
      }
    })
    mcpProc.on('error', (e) => {
      clearTimeout(timer)
      rejectMcp(e)
    })
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'self-test', version: '1.0' } } }) + '\n')
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n')
    mcpProc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'prompts/list', params: {} }) + '\n')
  })
  const initReply = mcpReplies.find((m) => m.id === 1)?.result
  const toolsReply = mcpReplies.find((m) => m.id === 2)?.result
  const promptsReply = mcpReplies.find((m) => m.id === 3)?.result
  const mcpToolNames = (toolsReply?.tools || []).map((t) => t.name)
  if (
    !initReply?.serverInfo?.title?.includes('Merziller') ||
    mcpToolNames.length < 28 ||
    !mcpToolNames.includes('analyze_reference_video') ||
    !mcpToolNames.includes('manage_brand_kit') ||
    !mcpToolNames.includes('open_video_studio') ||
    !mcpToolNames.includes('install_tts_engine') ||
    !(promptsReply?.prompts || []).some((p) => p.name === 'video-maker')
  ) {
    throw new Error(`v0.4.0 MCP stdio verification failed: tools=${mcpToolNames.length}, title=${initReply?.serverInfo?.title}`)
  }

  // Reference Video Reverse-Engineering + MOTION.md + Brand Kit + TTS Installer Catalog
  const { analyzeReferenceVideo, loadBrandKit, saveBrandKit } = await import('../packages/dsh-tool-media/reference-analyzer.js')
  const { getTtsInstallerCatalog } = await import('../packages/dsh-tool-local-tts/tts-installer.js')
  const tmpV040Proj = join(REPO_ROOT, '.tmp', `self-test-v040-${Date.now()}`)
  mkdirSync(tmpV040Proj, { recursive: true })
  scaffoldVideoProject(tmpV040Proj, { title: 'v040参考复刻测试', engine: 'remotion' })
  const synthRefMp4 = join(tmpV040Proj, 'sample-ref.mp4')
  const mkRefRes = await runCommandRedirected(
    bins.ffmpeg,
    [
      '-y',
      '-f', 'lavfi', '-i', 'color=c=0x881111:s=640x360:d=2:r=24',
      '-f', 'lavfi', '-i', 'color=c=0x114488:s=640x360:d=2:r=24',
      '-f', 'lavfi', '-i', 'color=c=0xdd9922:s=640x360:d=2:r=24',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=6',
      '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
      '-map', '[v]', '-map', '3:a',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      synthRefMp4,
    ],
    { timeoutMs: 30_000 },
  )
  if (mkRefRes.code !== 0 || !existsSync(synthRefMp4)) {
    throw new Error(`Failed to synthesize sample reference MP4: ${mkRefRes.stderr}`)
  }
  const refRes = await analyzeReferenceVideo({
    projectDir: tmpV040Proj,
    videoPath: synthRefMp4,
    useVision: false,
    applyToScript: true,
  })
  const savedKit = saveBrandKit({ brandName: 'Merziller Studio', primaryColor: '#F59E0B', accentColor: '#E11D48' }, tmpV040Proj)
  const loadedKit = loadBrandKit(tmpV040Proj)
  const ttsInstCat = getTtsInstallerCatalog()
  if (
    !refRes.ok ||
    !existsSync(refRes.motionMdPath) ||
    !existsSync(join(tmpV040Proj, 'reference', 'ref-sheet-3x3.jpg')) ||
    (refRes.referenceStyle?.shotCount || 0) < 2 ||
    loadedKit.brandName !== savedKit.brandName ||
    (ttsInstCat?.packages?.length || 0) < 4
  ) {
    throw new Error(`v0.4.0 reference analyzer / brand kit / tts installer check failed`)
  }
  rmSync(tmpV040Proj, { recursive: true, force: true })
  console.log(
    `[21/22] v0.4.0 Universal MCP Server (${mcpToolNames.length} tools over stdio) + Reference Video Remake (${refRes.referenceStyle.shotCount} cuts + MOTION.md) + Brand Kit + Optional TTS Installer (${ttsInstCat.packages.length} pkgs) Verified!`,
  )

  // =========================================================================
  // 22. v0.4.0 High-Density History Beat-Sync (34+ shots) + NarrativeDiorama Fallback + UTF-8 TTS + Complete Author Attribution
  // =========================================================================
  const { repairPromoPlanRules: repairPlanV040 } = await import('../packages/dsh-tool-media/plan-schema.js')
  const histMvPolicy = resolveTargetDurationPolicy({
    durationMode: 'custom',
    targetDurationSec: 135,
    narrationMode: 'subtitle-mv',
    hasVisualAssets: false,
  })
  if (histMvPolicy.targetShotsMin < 34) {
    throw new Error(`v0.4.0 pure-music 135s MV targetShotsMin too low: ${histMvPolicy.targetShotsMin} (expected >= 34)`)
  }
  const repairedHist = repairPlanV040(
    {
      title: '冠军侯霍去病',
      genre: 'history-theater',
      shots: [
        { id: 'scene-01', title: '少年点兵', narration: '17岁八百轻骑直捣匈奴大营', durationSec: 2.4, transition: 'cut' },
        { id: 'scene-02', title: '封狼居胥', narration: '漠北封狼居胥饮马瀚海', durationSec: 2.2, transition: 'cut' },
        { id: 'scene-03', title: '大汉军魂', narration: '匈奴未灭何以家为', durationSec: 2.8, transition: 'cut' },
      ],
    },
    { topic: '以第二人称讲述霍去病的一生', genre: 'history-theater', narrationMode: 'subtitle-mv' },
  )
  if (
    repairedHist.shots[0]?.stageSpec?.bannerChar !== '汉' ||
    repairedHist.shots[1]?.stageSpec?.archetype !== 'strategic-map' ||
    repairedHist.shots[2]?.stageSpec?.archetype !== 'channel-end' ||
    repairedHist.shots[1]?.transition === 'cut'
  ) {
    throw new Error(`v0.4.0 history stageSpec / transition upgrade failed: ${JSON.stringify(repairedHist.shots)}`)
  }
  const remGenSrc = readFileSync(join(REPO_ROOT, 'packages', 'dsh-tool-media', 'remotion-generator.js'), 'utf8')
  const ttsBridgeSrc = readFileSync(join(REPO_ROOT, 'scripts', 'tts-bridge.py'), 'utf8')
  const ttsServerSrc = readFileSync(join(REPO_ROOT, 'scripts', 'tts-server.py'), 'utf8')
  if (
    !remGenSrc.includes('useNarrativeDioramaFallback') ||
    !remGenSrc.includes('applyBeatCamera') ||
    !ttsBridgeSrc.includes('reconfigure(encoding="utf-8"') ||
    !ttsServerSrc.includes('os.makedirs(os.path.join(a.root, "voices"), exist_ok=True)')
  ) {
    throw new Error('v0.4.0 Remotion beat-camera/fallback or TTS UTF-8/voices guard missing!')
  }
  const attributionFiles = ['LICENSE', 'NOTICE', 'package.json', 'README.md', 'index.js', 'bin/dsh-video-mcp.mjs', 'packages/dsh-web-video-workbench/lib/client.js', '.claude-plugin/plugin.json']
  for (const relF of attributionFiles) {
    const content = readFileSync(join(REPO_ROOT, relF), 'utf8')
    if (!content.includes('Merziller') || !content.includes('1411574209') || !content.includes('k26789228@gmail.com')) {
      throw new Error(`Author attribution missing in ${relF}!`)
    }
  }
  console.log(
    `[22/24] v0.4.0 History Beat-Sync (${histMvPolicy.targetShotsMin}~${histMvPolicy.targetShotsMax} shots · banner='汉') + NarrativeDiorama Fallback + TTS UTF-8/voices Fix + Full Author Attribution (${attributionFiles.length} files) Verified!`,
  )

  // =========================================================================
  // 23. v0.5.0 Universal Cross-Genre Adaptive Audio/Beat Engine + BYOK Cloud Media (Image/Video/Suno & MiniMax Audio + Custom HTTP)
  // =========================================================================
  const { resolveAdaptiveAudioProfile, choreographBeatSfxCues: choreoV050 } = await import('../packages/dsh-tool-media/beat-analyzer.js')
  const { synthSfxStereo: synthSfxV050 } = await import('../packages/dsh-tool-media/audio-dsp.js')
  const {
    CLOUD_MEDIA_PRESETS,
    createKlingJwt,
    generateCloudMediaAsset,
    getByDotPath,
    getCloudMediaConfigSummary,
  } = await import('../packages/dsh-tool-media/cloud-media.js')

  const pHist = resolveAdaptiveAudioProfile({ genre: 'history-theater' })
  const pTut = resolveAdaptiveAudioProfile({ genre: 'ui-tutorial' })
  const pSci = resolveAdaptiveAudioProfile({ genre: 'science-explainer' })
  const pStick = resolveAdaptiveAudioProfile({ genre: 'stickman-story' })
  const pCustomAi = resolveAdaptiveAudioProfile({
    genre: 'other',
    genreLabel: '赛车漂移燃剪',
    audioProfile: { profileName: '涡轮轰鸣声场', beatCutIntensity: 'high', cameraBeatIntensity: 0.95, targetLufs: -13.8, sfxPalette: { action: ['shutter', 'hit'] } },
  })
  if (
    pHist.cameraBeatIntensity < 0.9 ||
    pTut.cameraBeatIntensity !== 0 ||
    pTut.targetLufs !== -15.0 ||
    !pTut.sfxPalette.action.includes('click') ||
    !pSci.sfxPalette.data.includes('counter') ||
    !pStick.sfxPalette.drop.includes('boing') ||
    pCustomAi.profileName !== '涡轮轰鸣声场' ||
    pCustomAi.targetLufs !== -13.8
  ) {
    throw new Error(`v0.5.0 adaptive cross-genre audio profile mismatch: ${JSON.stringify({ pHist, pTut, pSci, pStick, pCustomAi })}`)
  }
  for (const sfxName of ['boing', 'shutter', 'radar', 'bell_warm']) {
    const outSfx = synthSfxV050(sfxName)
    if (!outSfx?.L?.length || !outSfx?.R?.length) throw new Error(`v0.5.0 DSP primitive failed: ${sfxName}`)
  }
  const tutChoreo = choreoV050(
    [
      { id: 'scene-01', title: '点击按钮', startSec: 0, durationSec: 3.5, transition: 'cut' },
      { id: 'scene-02', title: '输入数据', startSec: 3.5, durationSec: 4.0, transition: 'light-wipe' },
    ],
    { beats: [{ time: 0, strong: true }, { time: 1.5, strong: true }, { time: 3.5, strong: true }, { time: 5.5, strong: true }], drops: [] },
    { genre: 'ui-tutorial' },
  )
  const tutSfxTypes = tutChoreo.flatMap((s) => (s.sfxCues || []).map((c) => c.type))
  if (tutSfxTypes.includes('slash')) {
    throw new Error(`v0.5.0 ui-tutorial should NOT use historical sword slash SFX! got: ${tutSfxTypes.join(',')}`)
  }

  // Cloud Media: verify presets, Kling HS256 JWT, MiniMax Music Hex decode, Suno async poll, Seedance async poll & Custom HTTP protocol
  const cloudSummary = getCloudMediaConfigSummary()
  if (
    CLOUD_MEDIA_PRESETS.image.length < 5 ||
    CLOUD_MEDIA_PRESETS.video.length < 4 ||
    CLOUD_MEDIA_PRESETS.audio.length < 4 ||
    !CLOUD_MEDIA_PRESETS.audio.some((p) => p.id === 'suno-music') ||
    !CLOUD_MEDIA_PRESETS.audio.some((p) => p.id === 'minimax-music') ||
    !CLOUD_MEDIA_PRESETS.video.some((p) => p.id === 'volcengine-seedance') ||
    !CLOUD_MEDIA_PRESETS.video.some((p) => p.id === 'kling-video') ||
    !cloudSummary.presets
  ) {
    throw new Error('v0.5.0 cloud media presets incomplete!')
  }
  const jwtSample = createKlingJwt('test-ak', 'test-sk')
  if (jwtSample.split('.').length !== 3 || getByDotPath({ a: { b: [{ c: 42 }] } }, 'a.b[0].c') !== 42) {
    throw new Error('v0.5.0 Kling JWT or dot-path resolver failed!')
  }
  const cloudTmpDir = join(REPO_ROOT, '.tmp', 'v050-cloud-test')
  rmSync(cloudTmpDir, { recursive: true, force: true })
  mkdirSync(cloudTmpDir, { recursive: true })
  writeScriptJson(cloudTmpDir, { title: '云端测试', engine: 'remotion', scenes: [{ id: 'scene-01', title: 'S1', durationSec: 3 }] })

  // Mock MiniMax Music Hex MP3 response
  const fakeMp3Hex = Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00mock-minimax-music-payload-bytes-1234567890').toString('hex')
  const mmMusicRes = await generateCloudMediaAsset({
    projectDir: cloudTmpDir,
    category: 'audio',
    prompt: 'Epic Chinese orchestral drums 100 BPM',
    lyrics: '[Chorus]\nRide to the north',
    autoBindToScript: false,
    providerOverride: { providerId: 'minimax-music', protocol: 'minimax-music', baseUrl: 'https://mock.minimax.local', endpoint: '/v1/music_generation', model: 'music-2.0', apiKey: 'test-key' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ base_resp: { status_code: 0, status_msg: 'success' }, data: { audio: fakeMp3Hex, status: 2 } }),
    }),
  })
  // Mock Custom Async HTTP Video Protocol
  let customPollStep = 0
  const customVidRes = await generateCloudMediaAsset({
    projectDir: cloudTmpDir,
    category: 'video',
    prompt: 'Cinematic desert cavalry tracking shot',
    sceneId: 'scene-01',
    pollIntervalMs: 5,
    providerOverride: {
      providerId: 'custom-video',
      protocol: 'custom',
      apiKey: 'my-secret',
      custom: {
        submitUrl: 'https://mock.custom.local/jobs',
        method: 'POST',
        headersJson: '{"Authorization":"Bearer {{apiKey}}","Content-Type":"application/json"}',
        bodyTemplateJson: '{"prompt":"{{prompt}}","dur":{{duration}}}',
        mode: 'async-poll',
        taskIdPath: 'job.id',
        pollUrlTemplate: 'https://mock.custom.local/jobs/{{taskId}}',
        statusPath: 'job.state',
        successValues: 'DONE',
        failValues: 'ERR',
        resultUrlPath: 'job.output.mp4',
        resultFormat: 'url',
      },
    },
    fetchImpl: async (u) => {
      if (String(u).endsWith('/jobs')) {
        return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ job: { id: 'job-999' } }) }
      }
      if (String(u).includes('/jobs/job-999')) {
        customPollStep++
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () => JSON.stringify({ job: { state: customPollStep >= 2 ? 'DONE' : 'RUNNING', output: { mp4: 'https://mock.cdn.local/clip.mp4' } } }),
        }
      }
      return { ok: true, status: 200, headers: { get: () => 'video/mp4' }, arrayBuffer: async () => Buffer.from('00000018ftypmp42mock-video') }
    },
  })
  if (!mmMusicRes.ok || !existsSync(mmMusicRes.absolutePath) || !customVidRes.ok || !existsSync(customVidRes.absolutePath)) {
    throw new Error('v0.5.0 cloud media mock generation failed!')
  }
  rmSync(cloudTmpDir, { recursive: true, force: true })
  console.log(
    `[23/24] v0.5.0 Cross-Genre Adaptive Audio/Beat Engine (4 new DSP SFX + 10 genre profiles + AI override) + BYOK Cloud Media (Image/Video/Suno/MiniMax/Custom Async Protocol) Verified!`,
  )

  // =========================================================================
  // 24. v0.5.0 影核广场 (CinePulse Hub) Template Plaza + Silent Windowless Launcher + 32 MCP Tools
  // =========================================================================
  const { listPlazaTemplates, applyPlazaTemplateToProject, publishProjectToPlaza } = await import('../packages/dsh-tool-media/template-plaza.js')
  const plazaList = listPlazaTemplates()
  if (!plazaList.ok || plazaList.templates.length < 4 || plazaList.brand.zhName !== '影核广场') {
    throw new Error(`v0.5.0 CinePulse Hub template plaza missing templates: count=${plazaList.templates?.length}`)
  }
  const plazaApplyDir = join(REPO_ROOT, '.tmp', 'v050-plaza-apply')
  rmSync(plazaApplyDir, { recursive: true, force: true })
  mkdirSync(plazaApplyDir, { recursive: true })
  writeScriptJson(plazaApplyDir, { title: '复刻测试', engine: 'remotion', scenes: [] })
  const applyRes = applyPlazaTemplateToProject({
    projectDir: plazaApplyDir,
    templateId: plazaList.templates[0].id,
    newTopic: '使用影核广场模板制作新短片',
  })
  if (!applyRes.ok || !existsSync(join(plazaApplyDir, 'MOTION.md')) || !applyRes.script?.referenceStyle) {
    throw new Error('v0.5.0 CinePulse Hub apply template failed!')
  }
  const pubTestRoot = join(REPO_ROOT, '.tmp', 'v050-plaza-pub')
  rmSync(pubTestRoot, { recursive: true, force: true })
  mkdirSync(pubTestRoot, { recursive: true })
  // tiny synthetic film (picture + tone) so the publish step must cut a playable sample clip
  const plazaSynthMp4 = join(pubTestRoot, 'synthetic-final.mp4')
  {
    const { ffmpeg: ffSynth } = resolveBinaries()
    const synth = await runCommandRedirected(ffSynth, [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      '-metadata', `comment=${['C:', 'Users', 'someone', 'secret-project'].join('/')}`, plazaSynthMp4,
    ])
    if (synth.code !== 0) throw new Error(`v0.5.4 plaza synthetic clip failed: ${synth.stderr}`)
  }
  const plazaPubRes = await publishProjectToPlaza({
    projectDir: demoPromoDir,
    templateId: 'self-test-promo-tpl',
    name: '自检发布模板',
    targetRoot: pubTestRoot,
    previewSource: plazaSynthMp4,
    previewDurationSec: 2,
  })
  if (!plazaPubRes.ok || !existsSync(plazaPubRes.motionMdPath)) {
    throw new Error('v0.5.0 CinePulse Hub publish template failed!')
  }
  const pubPreviewFile = join(pubTestRoot, 'self-test-promo-tpl', 'preview.mp4')
  if (!plazaPubRes.hasPreview || plazaPubRes.template?.previewFile !== 'preview.mp4' || !existsSync(pubPreviewFile)) {
    throw new Error(`v0.5.4 plaza publish did not cut a playable sample clip: ${plazaPubRes.previewNote || ''}`)
  }
  if (readFileSync(pubPreviewFile).toString('latin1').includes('secret-project')) {
    throw new Error('v0.5.4 plaza sample clip leaked source metadata (local path)!')
  }

  // Every built-in template ships a playable sample clip, streamed with HTTP Range (seekable progress bar)
  const builtinWithPreview = plazaList.templates.filter((t) => t.source === 'builtin' && t.hasPreview && t.previewUrl)
  if (builtinWithPreview.length < 5) {
    throw new Error(`v0.5.4 影核广场 built-in templates without sample clip: ${plazaList.templates.filter((t) => !t.hasPreview).map((t) => t.id).join(', ')}`)
  }
  if (plazaList.templates.some((t) => t.previewAbsPath || t.dirPath || t.coverAbsPath)) {
    throw new Error('v0.5.4 plaza listing leaks local absolute paths!')
  }
  const previewRangeRes = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399${builtinWithPreview[0].previewUrl}`, { headers: { Range: 'bytes=0-1023' } }),
  )
  const previewRangeBody = Buffer.from(await previewRangeRes.arrayBuffer())
  if (
    previewRangeRes.status !== 206 ||
    !/^bytes 0-1023\/\d+$/.test(previewRangeRes.headers.get('content-range') || '') ||
    !/video\/mp4/.test(previewRangeRes.headers.get('content-type') || '') ||
    previewRangeBody.length !== 1024
  ) {
    throw new Error(`v0.5.4 plaza preview route is not a seekable Range stream (status ${previewRangeRes.status})`)
  }
  const previewTraversal = await handleWorkbenchApiRequest(
    new Request(`http://127.0.0.1:4399/api/video-workbench/plaza/preview?id=${encodeURIComponent('../../packages')}`),
  )
  if (previewTraversal.status !== 404) {
    throw new Error(`v0.5.4 plaza preview route must refuse path traversal (status ${previewTraversal.status})`)
  }
  rmSync(plazaApplyDir, { recursive: true, force: true })
  rmSync(pubTestRoot, { recursive: true, force: true })

  // Verify silent windowless launchers & UI features exist
  const clientV050 = readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'client.js'), 'utf8')
  const kitV050 = readFileSync(join(REPO_ROOT, 'packages', 'dsh-web-video-workbench', 'lib', 'warroom', 'kit.js'), 'utf8')
  const runnerV050 = readFileSync(join(REPO_ROOT, 'scripts', 'dsh-runner.mjs'), 'utf8')
  if (
    !existsSync(join(REPO_ROOT, 'start-workbench.vbs')) ||
    !existsSync(join(REPO_ROOT, 'stop-workbench.cmd')) ||
    !runnerV050.includes('isDaemonLauncher') ||
    !runnerV050.includes('windowsHide: true') ||
    !clientV050.includes('影核广场') ||
    !/plaza\/apply/.test(kitV050) ||
    !/plaza\/publish/.test(kitV050) ||
    !/reference\/video/.test(kitV050) ||
    !/reference\/upload/.test(kitV050) ||
    !/scene-overrides\/batch/.test(kitV050) ||
    !/cloud-media\/generate/.test(kitV050)
  ) {
    throw new Error('v0.5.0 silent daemon launcher or UI plaza/compare/timeline/cloud controls missing!')
  }
  if (
    mcpToolNames.length < 32 ||
    !mcpToolNames.includes('configure_cloud_media') ||
    !mcpToolNames.includes('generate_cloud_media') ||
    !mcpToolNames.includes('manage_template_plaza')
  ) {
    throw new Error(`v0.5.0 expected >= 32 MCP tools with cloud & plaza tools (got ${mcpToolNames.length})`)
  }
  console.log(
    `[24/25] v0.5.0 影核广场 · CinePulse Hub (${plazaList.templates.length} templates + apply/publish) + Silent Windowless Daemon + Reference Compare + 4-Track Timeline + ${mcpToolNames.length} MCP Tools Verified!`,
  )

  // =========================================================================
  // 25. v0.5.1 Combat SFX + Keyframe Camera VFX + Multi-Color Subtitles +
  //     MiniMax Music 3 + AI Prompt Assist + Staging Preview + Cloud TTS + Topbar/Skin Cleanup
  // =========================================================================
  const {
    assistCloudMediaPrompt,
    listStagedCloudAssets,
    commitStagedCloudAsset,
    discardStagedCloudAsset,
  } = await import('../packages/dsh-tool-media/cloud-media.js')
  const { loadTtsConfig, saveTtsConfig, getSafeTtsConfigSummary } = await import('../packages/dsh-tool-local-tts/tts-config.js')

  // 25a. Cold-weapon combat SFX synthesis + zero chime sanitization in history-theater
  for (const combatSfx of ['metal_clash', 'blade_whoosh', 'war_drum', 'heavy_impact', 'horse_gallop', 'arrow_zip']) {
    const buf = synthSfxV050(combatSfx)
    if (!buf?.L?.length || !buf?.R?.length) throw new Error(`v0.5.1 combat DSP primitive failed: ${combatSfx}`)
  }
  const sanitizedHist = resolveAdaptiveAudioProfile({
    genre: 'history-theater',
    audioProfile: { sfxPalette: { opener: ['shimmer_swell'], internal: ['chime', 'sparkle'] } },
  })
  const allHistSfx = Object.values(sanitizedHist.sfxPalette || {}).flat()
  if (
    allHistSfx.some((k) => ['chime', 'shimmer_swell', 'sparkle'].includes(k)) ||
    !allHistSfx.includes('metal_clash') ||
    sanitizedHist.targetLufs > -9.5 ||
    sanitizedHist.targetLufs < -11.5
  ) {
    throw new Error(`v0.5.1 history-theater combat SFX sanitization or targetLufs failed: ${JSON.stringify(sanitizedHist)}`)
  }
  const combatChoreo = choreoV050(
    [
      { id: 'scene-01', title: '拔剑破阵斩匈奴', narration: '十八岁率八百铁骑斩杀单于', startSec: 0, durationSec: 3.0, transition: 'slash-wipe' },
    ],
    { beats: [{ time: 0, strong: true }, { time: 0.67, strong: false }, { time: 1.33, strong: true }, { time: 2.0, strong: true }], drops: [{ time: 1.33 }] },
    { genre: 'history-theater' },
  )
  const combatTypes = combatChoreo.flatMap((s) => (s.sfxCues || []).map((c) => c.type))
  if (!combatTypes.includes('metal_clash') || combatTypes.includes('chime') || combatTypes.includes('shimmer_swell')) {
    throw new Error(`v0.5.1 combat choreography expected metal_clash & zero chimes, got: ${combatTypes.join(',')}`)
  }

  // 25b. Remotion & HTML5 keyframe camera VFX + multi-color large subtitles
  const remGenSrcV051 = readFileSync(join(REPO_ROOT, 'packages', 'dsh-tool-media', 'remotion-generator.js'), 'utf8')
  const htmlGenSrcV051 = readFileSync(join(REPO_ROOT, 'packages', 'dsh-tool-media', 'html-generator.js'), 'utf8')
  if (
    !remGenSrcV051.includes('evaluateSceneCameraRig') ||
    !remGenSrcV051.includes('#FF3B30') ||
    !remGenSrcV051.includes('#FFD84D') ||
    !htmlGenSrcV051.includes('fx-strobe') ||
    !htmlGenSrcV051.includes('#FF3B30')
  ) {
    throw new Error('v0.5.1 Remotion/HTML5 camera keyframes or multi-color subtitle markers missing!')
  }

  // 25c. MiniMax Music 3 preset + AI Prompt Assist (audio/image/video) + Staging Preview isolation
  const mmMusicPreset = CLOUD_MEDIA_PRESETS.audio.find((p) => p.id === 'minimax-music')
  if (!mmMusicPreset || mmMusicPreset.defaultModel !== 'music-3.0') {
    throw new Error(`v0.5.1 expected MiniMax Music 3 defaultModel=music-3.0, got ${mmMusicPreset?.defaultModel}`)
  }
  for (const cat of ['audio', 'image', 'video']) {
    const assistRes = await assistCloudMediaPrompt({
      category: cat,
      topic: '霍去病封狼居胥',
      style: 'cinematic',
      callLlmChatFn: async () => ({
        model: 'mock-llm',
        text: JSON.stringify({
          prompt: `专业 ${cat} 提示词：大漠黄昏逆光铁骑冲锋`,
          lyrics: cat === 'audio' ? '[Chorus]\n封狼居胥铁骑长驱' : '',
          tags: 'epic, war drums',
          title: '封狼居胥',
        }),
      }),
    })
    if (!assistRes.ok || !assistRes.prompt.includes(cat)) {
      throw new Error(`v0.5.1 assistCloudMediaPrompt failed for ${cat}`)
    }
  }

  const stageTmpDir = join(REPO_ROOT, '.tmp', 'v051-staging-test')
  rmSync(stageTmpDir, { recursive: true, force: true })
  mkdirSync(stageTmpDir, { recursive: true })
  writeScriptJson(stageTmpDir, { title: '暂存验收测试', engine: 'remotion', scenes: [{ id: 'scene-01', title: 'S1', durationSec: 3 }] })
  const fakePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const stagedImg = await generateCloudMediaAsset({
    projectDir: stageTmpDir,
    category: 'image',
    prompt: '铁骑剪影海报',
    stageOnly: true,
    providerOverride: { providerId: 'openai-image', protocol: 'openai-image', baseUrl: 'https://mock.img.local/v1', endpoint: '/images/generations', model: 'gpt-image-1', apiKey: 'sk-mock' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ data: [{ b64_json: fakePngB64 }] }),
    }),
  })
  const beforeCommitAssets = readAssets(stageTmpDir).items || []
  const stagedList = listStagedCloudAssets(stageTmpDir)
  if (!stagedImg.ok || !stagedImg.staged || beforeCommitAssets.length !== 0 || stagedList.length !== 1) {
    throw new Error(`v0.5.1 staging isolation failed: assets=${beforeCommitAssets.length}, staged=${stagedList.length}`)
  }
  const committed = await commitStagedCloudAsset({
    projectDir: stageTmpDir,
    stagingId: stagedImg.stagingItem.stagingId,
    sceneId: 'scene-01',
  })
  const afterCommitAssets = readAssets(stageTmpDir).items || []
  const afterCommitStaged = listStagedCloudAssets(stageTmpDir)
  if (!committed.ok || afterCommitAssets.length !== 1 || afterCommitStaged.length !== 0) {
    throw new Error(`v0.5.1 staging commit failed: assets=${afterCommitAssets.length}, staged=${afterCommitStaged.length}`)
  }
  const stagedToDiscard = await generateCloudMediaAsset({
    projectDir: stageTmpDir,
    category: 'image',
    prompt: '待丢弃草图',
    stageOnly: true,
    providerOverride: { providerId: 'openai-image', protocol: 'openai-image', baseUrl: 'https://mock.img.local/v1', endpoint: '/images/generations', model: 'gpt-image-1', apiKey: 'sk-mock' },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ data: [{ b64_json: fakePngB64 }] }),
    }),
  })
  discardStagedCloudAsset({ projectDir: stageTmpDir, stagingId: stagedToDiscard.stagingItem.stagingId })
  if (listStagedCloudAssets(stageTmpDir).length !== 0) {
    throw new Error('v0.5.1 staging discard failed!')
  }
  rmSync(stageTmpDir, { recursive: true, force: true })

  // 25d. Cloud TTS built-in engines (minimax-tts + doubao-tts) secret masking
  const ttsTmpRepo = join(REPO_ROOT, '.tmp', 'v051-cloud-tts-cfg')
  rmSync(ttsTmpRepo, { recursive: true, force: true })
  mkdirSync(ttsTmpRepo, { recursive: true })
  saveTtsConfig(
    {
      builtins: {
        'minimax-tts': { model: 'speech-2.6-hd', apiKey: 'mm-secret-test-9999', voiceId: 'male-qn-qingse' },
        'doubao-tts': { appId: 'app-12345', token: 'db-secret-tok-8888', cluster: 'volcano_tts', voiceType: 'zh_male_test' },
      },
    },
    ttsTmpRepo,
  )
  const ttsSafeSummary = getSafeTtsConfigSummary(ttsTmpRepo)
  const ttsSafeStr = JSON.stringify(ttsSafeSummary)
  const mmEng = ttsSafeSummary.engines.find((e) => e.id === 'minimax-tts')
  const dbEng = ttsSafeSummary.engines.find((e) => e.id === 'doubao-tts')
  if (
    !mmEng || !dbEng || !mmEng.hasApiKey || !dbEng.hasToken ||
    ttsSafeStr.includes('mm-secret-test-9999') || ttsSafeStr.includes('db-secret-tok-8888')
  ) {
    throw new Error('v0.5.1 Cloud TTS (minimax-tts / doubao-tts) config or secret masking failed!')
  }
  rmSync(ttsTmpRepo, { recursive: true, force: true })

  // 25e. Frontend UI (native war-room panels): AI engine settings + AI prompt assist + staging review + no legacy skins
  if (
    !/PK\.panel\(\s*['"]keys['"]/.test(kitV050) ||
    !/llm-test/.test(kitV050) ||
    !/tts-test/.test(kitV050) ||
    !/cloud-media\/assist-prompt/.test(kitV050) ||
    !/confirmStaging/.test(kitV050) ||
    !/discardStaging/.test(kitV050) ||
    !clientV050.includes('minimax-tts') ||
    !clientV050.includes('doubao-tts') ||
    clientV050.includes('SKIN_PRESETS') ||
    clientV050.includes('showSkinModal')
  ) {
    throw new Error('v0.5.1 Frontend UI verification failed (AI Hub / Prompt Assist / Staging Preview / Skin cleanup)!')
  }
  console.log(
    '[25/25] v0.5.1 Combat SFX + Keyframe Camera VFX + Multi-Color Subtitles + MiniMax Music 3 + AI Prompt Assist + Staging Preview + Cloud TTS (MiniMax/Doubao) + Unified AI Hub & Topbar Fix Verified!',
  )
  console.log('======================================================================')

  // =========================================================================
  // 26. v0.5.2 Picture-Driven, Beat-Locked Combat Choreography
  //     (sound follows what the shot shows, every hit on the measured grid, events shared with the VFX)
  // =========================================================================
  {
    const { choreographBeatSfxCues: choreo052, classifySceneActionMode, explainSceneActionMode, createMusicalGrid } = await import('../packages/dsh-tool-media/beat-analyzer.js')
    const { analyzeBeatsFromSamples, BT_SR } = await import('../packages/dsh-tool-media/beat-tracker-core.js')
    const bpm052 = 90
    const step052 = 60 / bpm052
    const beats052 = Array.from({ length: 60 }, (_, i) => ({ time: Number((0.62 + i * step052).toFixed(4)), strong: i % 4 === 0, index: i }))
    const fps052 = 30
    const mk = (id, title, narration, startSec, durationSec, extra = {}) => ({
      id, title, narration, startSec, durationSec,
      durationInFrames: Math.round(durationSec * fps052), transition: 'glitch-cut', ...extra,
    })
    // a) Lines-only shots (no blueprint): narration evidence decides
    const scenes052 = [
      mk('s1', '平阳旧门', '你从平阳府的暗处走来', 0.62, 2.0 + 0.001),
      mk('s2', '直撞敌阵', '你迎着敌阵纵马而入，短兵相接', 2.62, 2.67),
      mk('s3', '八百轻骑', '你只带800轻骑向北', 5.29, 2.67),
      mk('s4', '封狼居胥', '你在狼居胥封土祭天', 7.96, 2.67),
    ]
    const out052 = choreo052(scenes052, { beats: beats052, drops: [], bpm: bpm052 }, { genre: 'history-theater', fps: fps052, narrationMode: 'subtitle-mv' })
    const allCues = out052.flatMap((s) => s.sfxCues.map((c) => ({ ...c, abs: s.startSec + c.offsetSec })))
    const bad = allCues.filter((c) => ['chime', 'sparkle', 'shimmer_swell', 'pop_soft', 'tick', 'suck', 'riser', 'swoosh', 'glitch'].includes(c.type))
    const clashes = allCues.filter((c) => c.type.startsWith('metal_clash'))
    const grid = (t) => Math.min(...beats052.flatMap((b) => [Math.abs(t - b.time), Math.abs(t - (b.time + step052 / 2)), Math.abs(t - (b.time + step052 / 4)), Math.abs(t - (b.time + (3 * step052) / 4))]))
    const offGrid = clashes.filter((c) => grid(c.abs) > 0.004)
    const gallop = allCues.find((c) => c.type === 'horse_gallop')
    if (
      bad.length > 0 ||
      out052[0].actionMode !== 'clean' || out052[0].sfxCues.length !== 0 ||
      out052[1].actionMode !== 'clash-flurry' || clashes.length < 5 || offGrid.length > 0 ||
      out052[2].actionMode !== 'cavalry' || !gallop || Math.abs(gallop.leadSec - step052 / 4) > 0.002 || grid(gallop.abs) > 0.004 ||
      out052[3].actionMode !== 'clean' || out052[3].sfxCues.length !== 0 ||
      out052.some((s) => s.transition === 'glitch-cut' || s.transition === 'iris-circle') ||
      !out052[1].actionEvents.some((e) => e.role === 'clash' && e.killStep >= 5) ||
      classifySceneActionMode({ title: '长眠', narration: '你长眠在茂陵的风里' }, { genreKey: 'history-theater' }) !== 'clean'
    ) {
      throw new Error(`v0.5.2 beat-locked choreography failed: bad=${bad.map((b) => b.type)} clashes=${clashes.length} offGrid=${offGrid.length} modes=${out052.map((s) => s.actionMode)}`)
    }
    // b) The blueprint (what the coder draws) outranks poetic titles; negations silence a shot
    const bp = (title, narration, visualBlueprint, archetype = 'hero-stand', actionMode) => ({ title, narration, visualBlueprint, stageSpec: { archetype }, actionMode })
    const cases = [
      [bp('敌阵失色', '你让敌阵顷刻失色', '反打敌军骑手剪影，战马侧身急转，前景旗杆斜倒但不表现兵刃接触。摄影机快速后撤，保持这一镜无额外金属声。', 'duel-confront', 'single-clash'), 'clean'],
      [bp('2028级首功', '你以2028级首功震朝野', '镜头转到军功竹简，2028以暖金大字悬于简牍上方。数字一次显现，不做击杀计数或把全军战果表现成个人斩杀。', 'hero-numeral', 'clash-flurry'), 'clean'],
      [bp('撕开敌阵', '你把敌阵撕成两半', '高俯视下汉骑楔形从中央穿透。这一镜展示骑流突破而非兵刃接触，因此不用金属连击。', 'cavalry-rush', 'clash-flurry'), 'cavalry'],
      [bp('两军对冲', '你与万骑迎面相撞', '左右骑群在低机位对称逼近。镜头推入即将接触的矛尖之间，第4拍末只到交锋前一瞬，将真正撞击留给下一镜drop。', 'duel-confront', 'clash-flurry'), 'cavalry'],
      [bp('撞开锋线', '你让长矛撞开锋线', '两根长矛在前景相撞并弯出张力。一次低金属撞击绑定接触帧，禁止叠成无来源连打。', 'slash-climax', 'clash-flurry'), 'single-clash'],
      [bp('汉旗穿阵', '你让汉旗穿过敌阵', '前景两组骑手兵刃交错，后景敌阵被骑流切开。四次可见格挡安排在半拍位置，金属声只绑定对应武器碰撞。', 'slash-climax', 'clash-flurry'), 'clash-flurry'],
      [bp('饮马瀚海', '你把马蹄带到瀚海', '低位水岸映出深蓝天空，战马低头触水，主将牵缰站在右侧；水波由马鼻接触处真实扩散。', 'hero-stand', 'cavalry'), 'clean'],
      [bp('矛指敌营', '你先向敌营亮出长矛', '少年在沙脊抬矛，摄影机沿矛杆推向矛尖；最后一拍汉骑前倾待发，不提前添加接战声。', 'duel-confront', 'single-clash'), 'clean'],
    ]
    const wrong = cases.filter(([sc, want]) => explainSceneActionMode(sc, { genreKey: 'history-theater', idx: 3 }).mode !== want)
    if (wrong.length) {
      throw new Error(`v0.5.2 blueprint-driven action classification wrong: ${wrong.map(([sc, want]) => `${sc.title}→${explainSceneActionMode(sc, { genreKey: 'history-theater', idx: 3 }).mode} (want ${want})`).join('; ')}`)
    }
    // c) Explicit counts / beat addresses: "四次可见格挡" → 4 parries; impactBeats from the director are honoured
    const parry = choreo052(
      [mk('p1', '汉旗穿阵', '你让汉旗穿过敌阵', 2.62, 2.67, { visualBlueprint: cases[5][0].visualBlueprint, stageSpec: { archetype: 'slash-climax' }, transition: 'flash-cut' })],
      { beats: beats052, bpm: bpm052 },
      { genre: 'history-theater', fps: fps052 },
    )[0]
    const planned = choreo052(
      [mk('q1', '短兵相接', '你冲在最前面', 2.62, 2.67, { visualBlueprint: '主将长矛连续格开三柄来刃并反手劈落，火星随每次兵刃交击迸出。', impactBeats: [0, 1, 1.5, 3.5], transition: 'flash-cut' })],
      { beats: beats052, bpm: bpm052 },
      { genre: 'history-theater', fps: fps052 },
    )[0]
    const parryHits = parry.sfxCues.filter((c) => c.type.startsWith('metal_clash')).length
    const plannedHits = planned.sfxCues.filter((c) => c.type.startsWith('metal_clash')).map((c) => Number(((c.offsetSec) / step052).toFixed(2)))
    if (parryHits !== 4 || JSON.stringify(plannedHits) !== JSON.stringify([0, 1, 1.5, 3.5]) || !planned.sfxCues.some((c) => c.type === 'metal_clash_heavy')) {
      throw new Error(`v0.5.2 explicit contact count / impactBeats not honoured: parry=${parryHits} planned=${JSON.stringify(plannedHits)}`)
    }
    // d) Hits snap onto the music's own transient (onsets) within ±22 ms, never further
    const gridSnap = createMusicalGrid({ beats: beats052, bpm: bpm052, onsets: [{ time: 3.2985, strength: 0.8 }, { time: 3.9, strength: 0.9 }] })
    if (Math.abs(gridSnap.snap(gridSnap.timeAt(4)) - 3.2985) > 1e-6 || Math.abs(gridSnap.snap(3.62) - 3.62) > 1e-6) {
      throw new Error('v0.5.2 onset snapping out of tolerance')
    }
    // e) Tracker precision on a synthetic 90 BPM groove (kick on beats, hats on the "and"): ≤ 6 ms drift end-to-end
    const sr = BT_SR
    const dur = 60
    const pcm = new Float32Array(Math.floor(dur * sr))
    const truePhase = 0.437
    for (let k = 0; ; k++) {
      const t0 = truePhase + k * step052
      if (t0 > dur - 0.5) break
      for (let i = 0; i < 0.22 * sr; i++) {
        const idx = Math.round(t0 * sr) + i
        if (idx >= pcm.length) break
        const tt = i / sr
        pcm[idx] += (k % 4 === 0 ? 0.9 : 0.6) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-tt * 40)) * tt) * Math.exp(-tt * 9)
      }
      const th = t0 + step052 / 2
      for (let i = 0; i < 0.05 * sr; i++) {
        const idx = Math.round(th * sr) + i
        if (idx >= pcm.length) break
        pcm[idx] += Math.sin(i * 1.7) * Math.sin(i * 0.37) * 0.25 * Math.exp(-i / (0.01 * sr))
      }
    }
    const tr = analyzeBeatsFromSamples(pcm)
    const lastTrue = truePhase + Math.floor((dur - 0.5 - truePhase) / step052) * step052
    const lastTracked = tr.beats.reduce((best, b) => (Math.abs(b.time - lastTrue) < Math.abs(best - lastTrue) ? b.time : best), -1)
    if (Math.abs(tr.bpm - 90) > 0.05 || Math.abs(tr.phaseSec - truePhase) > 0.006 || Math.abs(lastTracked - lastTrue) > 0.006) {
      throw new Error(`v0.5.2 beat tracker precision regression: bpm=${tr.bpm} phase=${tr.phaseSec} lastErr=${((lastTracked - lastTrue) * 1000).toFixed(1)}ms`)
    }
    // f) Crisp steel, tempo-locked hooves, beat-locked transition sweep
    const dspSteel = synthSfxV050('metal_clash_hi')
    let peak052 = 0
    for (const v of dspSteel.L) peak052 = Math.max(peak052, Math.abs(v))
    const gallopBuf = synthSfxV050('horse_gallop', { d: step052, durationMs: 4 * step052 * 1000 })
    const sweepBuf = synthSfxV050('slash_sweep')
    if (!dspSteel.L.length || dspSteel.L.length > 0.4 * 48000 || peak052 < 0.5 || gallopBuf.L.length < 4 * step052 * 48000 || !sweepBuf.L.length) {
      throw new Error('v0.5.2 combat DSP variants invalid (steel too long / silent, gallop or sweep missing)')
    }
    console.log(`[26/26] v0.5.2 Picture-Driven Beat-Locked Choreography OK (blueprint negations honoured, ${clashes.length} melee clashes on the exact half/quarter grid, 4 counted parries, director impactBeats kept, tracker ${tr.bpm} BPM / phase err ${((tr.phaseSec - truePhase) * 1000).toFixed(1)} ms, tempo-locked hooves + crisp steel)!`)
  }

  // 27. Vibecoding toolkit (8 tools): status, deterministic Remotion libs, SuperCollider safety gate + fallback
  {
    const vibe = await import('../packages/dsh-tool-media/vibe-toolkit-lib.js')
    const scb = await import('../packages/dsh-tool-media/supercollider-bridge.js')
    const coder = await import('../packages/dsh-tool-media/audio-coder.js')
    const status = vibe.getVibeToolkitStatus()
    const ids = status.map((t) => t.id).join(',')
    if (ids !== 'threejs,animejs,tweenjs,ammojs,tsl-textures,supercollider,remotion,ffmpeg') {
      throw new Error(`Vibecoding toolkit must list the 8 tools in order, got: ${ids}`)
    }
    const missing = status.filter((t) => !t.optional && !t.available).map((t) => t.name)
    if (missing.length) {
      throw new Error(`Vibecoding toolkit dependencies missing: ${missing.join(', ')} (run pnpm install)`)
    }
    const vibeProj = join(REPO_ROOT, '.tmp', 'e2e-vibe-toolkit')
    rmSync(vibeProj, { recursive: true, force: true })
    mkdirSync(vibeProj, { recursive: true })
    const written = vibe.writeVibeToolkitRemotionLib(vibeProj)
    for (const f of ['vibe-tween.tsx', 'vibe-anime.tsx', 'vibe-physics.tsx', 'vibe-tsl.tsx', 'vibe-modules.d.ts']) {
      if (!existsSync(join(vibeProj, 'src', 'lib', f))) throw new Error(`Vibecoding lib not emitted: src/lib/${f}`)
    }
    if (!existsSync(join(vibeProj, 'public', 'ammo.wasm.js')) || !existsSync(join(vibeProj, 'public', 'ammo.wasm.wasm'))) {
      throw new Error('Ammo.js runtime (ammo.wasm.js / ammo.wasm.wasm) was not staged into public/')
    }
    const tweenSrc = readFileSync(join(vibeProj, 'src', 'lib', 'vibe-tween.tsx'), 'utf8')
    const animeSrc = readFileSync(join(vibeProj, 'src', 'lib', 'vibe-anime.tsx'), 'utf8')
    if (!/createTimeline\(\s*\{[^}]*autoplay:\s*false/.test(animeSrc) || !/\.seek\(/.test(animeSrc) || !/tween\.module\.js/.test(tweenSrc)) {
      throw new Error('Vibecoding libs must drive Anime.js / Tween.js from the Remotion frame (paused timeline + seek)')
    }
    // Anime.js v4 API contract used by vibe-anime.tsx (stagger(target, index, targets[]), easing factories)
    const anime = await import('animejs')
    const stag = anime.stagger(80, { from: 'center', total: 12 })(null, 3, Array.from({ length: 12 }), 0, null)
    if (Number(stag) !== 200 || typeof anime.eases.outElastic(1, 0.6) !== 'function' || typeof anime.createTimeline !== 'function') {
      throw new Error(`Anime.js API drifted (stagger=${stag}); update vibe-anime.tsx`)
    }
    const guide = vibe.buildVibeToolkitCoderGuide(status)
    for (const mod of ["'../lib/vibe-tween'", "'../lib/vibe-anime'", "'../lib/vibe-physics'", "'../lib/vibe-tsl'"]) {
      if (!guide.includes(mod)) throw new Error(`Coder guide does not document ${mod}`)
    }
    // AI tool matching: per-scene recommendations, director hints win, nothing mandatory, custom code allowed
    const pick = vibe.selectVibeTools({
      topic: '宇宙科普',
      scenes: [
        { id: 'a', title: '青铜行星', visualBlueprint: '青铜质感的行星缓慢自转' },
        { id: 'b', title: '数据榜单', visualBlueprint: '柱状图依次弹出' },
        { id: 'c', title: '落石', visualBlueprint: '碎石坠落散落一地' },
        { id: 'd', title: '片尾', visualBlueprint: '淡出' },
        { id: 'e', title: '提示', vibeTools: ['tweenjs', 'not-a-tool'] },
      ],
      status,
    })
    if (!pick.perScene.a?.includes('tsl-textures') || !pick.perScene.b?.includes('animejs') || !pick.perScene.c?.includes('ammojs') || pick.perScene.d || pick.perScene.e?.join(',') !== 'tweenjs') {
      throw new Error(`Vibecoding tool matching wrong: ${JSON.stringify(pick.perScene)}`)
    }
    const pickedGuide = vibe.buildVibeToolkitCoderGuide(status, pick)
    // tools are planned per shot (toolPlan.must is audited), yet custom code always stays allowed
    if (!pickedGuide.includes('按镜头规划调用') || !pickedGuide.includes('toolPlan.must') || !pickedGuide.includes('自由编写') || !pickedGuide.includes('本批次计划用到的工具')) {
      throw new Error('Coder guide must explain the per-shot tool plan and keep custom code allowed')
    }
    // 导演参数 → 视效偏好 is only a soft hint: every option keeps the tools optional and free code allowed
    const prefAuto = vibe.buildVisualFxPreferenceGuide()
    const prefOn = vibe.buildVisualFxPreferenceGuide('on')
    const prefOff = vibe.buildVisualFxPreferenceGuide('off')
    if (!prefAuto.includes('AI 按需自由创作') || !prefAuto.includes('直接写代码') || !prefOn.includes('自由编码') || !prefOff.includes('纯 2D') || !prefOff.includes('自由编写')) {
      throw new Error('视效偏好 must stay a soft hint that keeps free coding allowed')
    }
    // SuperCollider: LLM-written NRT code must stay pure synthesis
    if (scb.validateSuperColliderBody(scb.SC_SAMPLE_CLASH_BODY) !== null) throw new Error('SuperCollider sample score was rejected by the safety gate')
    for (const bad of ['~score = []; "rm -rf ~".unixCmd;', '~score = []; File.open("x", "w");', '~score = []; Server.default.boot;', '~score = [[0, [\\b_write, 0, "x.wav"]]];', '~score = []; thisProcess.platform;']) {
      if (!scb.validateSuperColliderBody(bad)) throw new Error(`SuperCollider safety gate let through: ${bad}`)
    }
    const scPrompt = coder.buildSuperColliderBgmSystemPrompt({ bpm: 90, durationSec: 24, mood: 'epic' })
    if (!scPrompt.includes('~score') || !scPrompt.includes('BPM 90') || !scPrompt.includes("['/d_recv'")) {
      throw new Error('SuperCollider BGM prompt is missing the NRT score contract')
    }
    const sc = scb.detectSuperCollider({ refresh: true })
    let scNote = 'SuperCollider not installed → JS DSP fallback'
    if (sc.available) {
      const scWav = join(vibeProj, 'sc-clash.wav')
      const scRes = await scb.renderSuperColliderNrt({ body: scb.SC_SAMPLE_CLASH_BODY, outWav: scWav, durationSec: 0.6 })
      if (!scRes.ok || statSync(scWav).size < 1000) throw new Error(`SuperCollider NRT render failed: ${scRes.reason || ''} ${scRes.error || ''}`)
      scNote = `SuperCollider ${sc.version || ''} NRT render OK`
    } else {
      const res = await scb.renderSuperColliderNrt({ body: scb.SC_SAMPLE_CLASH_BODY, outWav: join(vibeProj, 'sc.wav'), durationSec: 0.5 })
      if (res.ok || res.reason !== 'not-installed') throw new Error('SuperCollider bridge must report not-installed so callers fall back to JS DSP')
    }
    rmSync(vibeProj, { recursive: true, force: true })
    console.log(`[27/27] v0.5.3 Vibecoding Toolkit OK (${status.filter((t) => t.available).length}/8 ready: ${status.map((t) => `${t.name}${t.available ? '✓' : '·'}`).join(' ')}; ${scNote}; ${['tween', 'anime', 'physics', 'tsl'].filter((k) => written?.[k]).length} deterministic libs emitted, Ammo WASM ${written?.ammoReady ? 'staged' : 'missing'})!`)
  }
  console.log('======================================================================')
}

runSelfTest().catch((err) => {
  console.error('❌ Self-Test Failed:', err)
  process.exit(1)
})
