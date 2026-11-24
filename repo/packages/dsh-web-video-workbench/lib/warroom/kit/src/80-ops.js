/* ============================================================================================================
 * PK · 运营面板 (panel agent D) — 任务中心 `tasks` · 影核广场 `plaza` · 参考复刻 `reference` · 提词器录制 `teleprompter`
 *
 * Behaviour ported from the deleted classic UI (.tmp/kit-ref/client.classic.js): taskCenterView + fetchTaskRuns /
 * handleTaskControl + billing stop, plazaModal / plazaPlayerModal + handleRefreshPlaza / handlePreviewPlazaTemplate /
 * handleApplyPlazaTemplate / handlePublishToPlaza, handleUploadReferenceVideo / handleClearReferenceVideo / compareModal
 * (synced player), and the step-1 拍摄棚 (teleprompter + webcam recording + mic meter + save to the asset library).
 *
 * Panel-specific structural classes (all prefixed `pk-ops-`, injected once as a zero-specificity stylesheet so every skin
 * can restyle them): toolbar · tasks/runlist/detail/agents/steps/log · cover/player/swatches/md · dna/sheet/cuts/cmp/
 * pane/transport · stage/vf/rec/count/pwrap/pbox/ptext/readline/vu/take. Colours come from the --pk-* variables.
 * ============================================================================================================ */
;(function () {
  'use strict'
  const PK = window.PK
  if (!PK || !PK.panel || !PK.ui) return
  const U = PK.util
  const h = PK.h
  const ui = PK.ui

  /* ================================================================ structural styles (zero specificity) */
  const W = ':where(#pk-root)'
  const CSS = `
/* the frame body and section bodies are flex columns: blocks with their own height (or only absolutely positioned
   children, like the viewfinder stage) must never be squeezed when the panel content is taller than the window */
${W} :is(.pk-ops-toolbar,.pk-ops-tasks,.pk-ops-detail,.pk-ops-dh,.pk-ops-agents,.pk-ops-steps,.pk-ops-log,.pk-ops-player,.pk-ops-swatches,.pk-ops-md,.pk-ops-pub,.pk-ops-dna,.pk-ops-sheet,.pk-ops-stats,.pk-ops-cuts,.pk-ops-axis,.pk-ops-formula,.pk-ops-cmp,.pk-ops-transport,.pk-ops-stage,.pk-ops-vu,.pk-ops-take,.pk-ops-sliders){flex-shrink:0}
${W} .pk-ops-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;min-width:0}
${W} .pk-ops-toolbar>.pk-input{flex:1 1 220px;width:auto;min-width:180px}
${W} .pk-ops-grow{flex:1 1 auto;min-width:0}
${W} .pk-ops-sub{margin:0;font-size:12px;line-height:1.55;color:var(--pk-ink3);overflow-wrap:anywhere}
${W} .pk-ops-mono{font-family:var(--pk-font-mono)}
${W} .pk-ops-body{margin:0;font-size:12.5px;line-height:1.7;color:var(--pk-ink2);overflow-wrap:anywhere;white-space:pre-wrap}
${W} .pk-ops-h3{margin:0;font:700 15px/1.45 var(--pk-font-title);color:var(--pk-ink);overflow-wrap:anywhere}
${W} .pk-ops-big{font:800 30px/1 var(--pk-font-mono);color:var(--pk-acc);flex:none}
/* tasks */
${W} .pk-ops-tasks{display:grid;grid-template-columns:minmax(190px,250px) minmax(0,1fr);gap:16px;align-items:start;min-width:0}
${W} .pk-ops-runlist{position:sticky;top:0;display:flex;flex-direction:column;gap:6px;min-width:0;max-height:calc(100vh - 230px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
${W} .pk-ops-runlist .pk-item{align-items:flex-start;flex:none}
${W} .pk-ops-runmeta{display:flex;align-items:center;gap:8px;margin-top:4px;min-width:0}
${W} .pk-ops-runmeta>.pk-meter{flex:1 1 auto;min-width:40px}
${W} .pk-ops-detail{display:flex;flex-direction:column;gap:14px;min-width:0}
${W} .pk-ops-dh{display:flex;align-items:center;gap:14px;min-width:0;flex-wrap:wrap}
${W} .pk-ops-dh-t{flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:3px}
${W} .pk-ops-agents{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;min-width:0}
${W} .pk-ops-agent{display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-agent-h{display:flex;align-items:center;justify-content:space-between;gap:6px;min-width:0}
${W} .pk-ops-agent-h b{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px}
${W} .pk-ops-agent p{margin:0;font-size:11.5px;line-height:1.5;color:var(--pk-ink3);overflow-wrap:anywhere}
${W} .pk-ops-agent.is-running{border-color:var(--pk-acc)}
${W} .pk-ops-agent.is-failed,${W} .pk-ops-agent.is-stopped{border-color:color-mix(in srgb,var(--pk-err) 55%,transparent)}
${W} .pk-ops-agent.is-skipped,${W} .pk-ops-agent.is-idle{opacity:.72}
${W} .pk-ops-steps{display:flex;flex-direction:column;gap:6px;min-width:0}
${W} .pk-ops-step{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:6px 12px;padding:10px 12px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-step.is-running{border-color:var(--pk-acc)}
${W} .pk-ops-step.is-failed,${W} .pk-ops-step.is-stopped{border-color:color-mix(in srgb,var(--pk-err) 55%,transparent)}
${W} .pk-ops-step-t{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
${W} .pk-ops-step-t>b{min-width:0;overflow-wrap:anywhere}
${W} .pk-ops-step-n{flex:none;display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 4px;border-radius:6px;background:var(--pk-bg3);font:800 11px/1 var(--pk-font-mono);color:var(--pk-ink2)}
${W} .pk-ops-step-m{grid-column:1 / -1;display:flex;flex-direction:column;gap:5px;min-width:0}
${W} .pk-ops-msg{margin:0;font-size:12px;line-height:1.6;color:var(--pk-ink2);overflow-wrap:anywhere;white-space:pre-wrap}
${W} .pk-ops-msg.is-err{color:var(--pk-err)}
${W} .pk-ops-log{max-height:min(360px,46vh);min-height:90px}
${W} .pk-ops-log .pk-log-l em{max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* plaza */
${W} .pk-ops-cover{position:relative;display:block;width:100%;height:100%;padding:0;border:0;margin:0;background:#05070d;cursor:pointer;overflow:hidden}
${W} .pk-ops-cover>img{display:block;width:100%;height:100%;object-fit:cover}
${W} .pk-ops-cover-ph{position:absolute;inset:0;display:grid;place-items:center;color:rgba(255,255,255,.55)}
${W} .pk-ops-cover-play{position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;display:grid;place-items:center;background:rgba(5,8,15,.62);color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.45);transition:transform .15s ease}
${W} .pk-ops-cover:hover .pk-ops-cover-play{transform:scale(1.08)}
${W} .pk-ops-cover-len{position:absolute;right:8px;bottom:8px;padding:2px 8px;border-radius:999px;background:rgba(5,8,15,.8);color:#e2e8f0;font:700 12px/1.5 var(--pk-font-mono);white-space:nowrap}
${W} .pk-ops-cover-src{position:absolute;right:8px;top:8px;padding:2px 8px;border-radius:999px;background:rgba(5,8,15,.8);color:#fde68a;font-size:12px;font-weight:800;white-space:nowrap}
${W} .pk-ops-meta{margin:0;font:600 12px/1.5 var(--pk-font-mono);color:var(--pk-ink3);overflow-wrap:anywhere}
${W} .pk-ops-player{position:relative;display:flex;align-items:center;justify-content:center;min-height:200px;background:#000;border-radius:var(--pk-radius);overflow:hidden;min-width:0}
${W} .pk-ops-player>video,${W} .pk-ops-player>img{display:block;width:100%;max-height:min(60vh,620px);object-fit:contain;background:#000}
${W} .pk-ops-player.is-vertical>video,${W} .pk-ops-player.is-vertical>img{width:auto;max-width:100%;height:min(60vh,620px)}
${W} .pk-ops-ov{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px;text-align:center;background:rgba(5,8,15,.8);color:#f1f5f9;font-size:13px;line-height:1.6}
${W} .pk-ops-ov.is-tap{background:rgba(5,8,15,.35)}
${W} .pk-ops-swatches{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
${W} .pk-ops-sw{display:inline-flex;align-items:center;gap:6px;padding:2px 8px 2px 3px;border-radius:999px;border:1px solid var(--pk-line);background:var(--pk-bg2);font:600 11px/1.6 var(--pk-font-mono);color:var(--pk-ink2);white-space:nowrap}
${W} .pk-ops-sw>i{width:16px;height:16px;border-radius:50%;border:1px solid rgba(127,127,127,.4);flex:none}
${W} .pk-ops-md{max-height:min(420px,52vh)}
${W} .pk-ops-md code,${W} .pk-ops-md-full code{white-space:pre-wrap;overflow-wrap:anywhere}
${W} .pk-ops-md-full{max-height:none}
${W} .pk-ops-pub{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:12px;align-items:start}
/* plaza community: 投稿 / 我的投稿 / 在线模板 */
${W} :is(.pk-ops-share,.pk-ops-channels,.pk-ops-file,.pk-ops-syncbar){flex-shrink:0}
${W} .pk-ops-cover-src.is-online{color:#bbf7d0;background:rgba(6,64,48,.86)}
${W} .pk-ops-share{display:flex;flex-direction:column;gap:6px;min-width:0}
${W} .pk-ops-file{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:2px 10px;align-items:center;padding:8px 10px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-file>i{grid-row:1 / span 2;align-self:start;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--pk-bg3);color:var(--pk-acc)}
${W} .pk-ops-file>b{min-width:0;font:700 12.5px/1.45 var(--pk-font-mono);color:var(--pk-ink);overflow-wrap:anywhere}
${W} .pk-ops-file>em{font:600 11.5px/1.45 var(--pk-font-mono);font-style:normal;color:var(--pk-ink3);white-space:nowrap}
${W} .pk-ops-file>p{grid-column:2 / -1;margin:0;font-size:12px;line-height:1.55;color:var(--pk-ink2);overflow-wrap:anywhere}
${W} .pk-ops-nots{margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:var(--pk-ink3)}
${W} .pk-ops-nots>li{overflow-wrap:anywhere}
${W} .pk-ops-channels{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:10px;min-width:0}
${W} .pk-ops-channel{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-channel>b{font-size:13px;line-height:1.45;color:var(--pk-ink);overflow-wrap:anywhere}
${W} .pk-ops-channel>p{margin:0;font-size:12px;line-height:1.6;color:var(--pk-ink2);overflow-wrap:anywhere}
${W} .pk-ops-pkgpath{margin:0;font:600 11.5px/1.5 var(--pk-font-mono);color:var(--pk-ink2);overflow-wrap:anywhere;word-break:break-all}
${W} .pk-ops-subthumb{display:block;width:96px;aspect-ratio:16 / 9;border-radius:6px;object-fit:cover;background:#05070d}
${W} .pk-ops-syncbar{display:flex;flex-direction:column;gap:6px;min-width:0}
/* reference */
${W} .pk-ops-dna{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:18px;align-items:start;min-width:0}
${W} .pk-ops-sheet{display:block;width:100%;padding:0;border:1px solid var(--pk-line);border-radius:var(--pk-radius);overflow:hidden;background:#05070d;cursor:zoom-in}
${W} .pk-ops-sheet>img{display:block;width:100%;height:auto;max-height:min(46vh,460px);object-fit:contain}
${W} .pk-ops-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px;min-width:0}
${W} .pk-ops-stats .pk-stat{min-width:0}
${W} .pk-ops-stats .pk-stat-v{font-size:19px;overflow-wrap:anywhere}
${W} .pk-ops-cuts{position:relative;height:30px;border-radius:var(--pk-radius-sm);background:var(--pk-bg3);border:1px solid var(--pk-line);overflow:hidden}
${W} .pk-ops-cuts>i{position:absolute;top:4px;bottom:4px;width:2px;margin-left:-1px;background:var(--pk-acc);opacity:.85}
${W} .pk-ops-cuts>i.is-drop{top:0;bottom:0;width:3px;background:var(--pk-warn);opacity:1}
${W} .pk-ops-axis{display:flex;justify-content:space-between;gap:8px;font:600 10.5px/1.4 var(--pk-font-mono);color:var(--pk-ink3)}
${W} .pk-ops-formula{display:flex;flex-direction:column;gap:6px}
${W} .pk-ops-fx{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;padding:8px 10px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2)}
${W} .pk-ops-fx>b{grid-column:1 / -1;font-size:12.5px;overflow-wrap:anywhere}
${W} .pk-ops-fx>span{font:600 11px/1.6 var(--pk-font-mono);color:var(--pk-acc);white-space:nowrap}
${W} .pk-ops-fx>p{margin:0;font-size:12px;line-height:1.6;color:var(--pk-ink2);overflow-wrap:anywhere}
${W} .pk-ops-cmp{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;padding:8px;border-radius:var(--pk-radius);background:#05070d;min-width:0}
${W} .pk-ops-cmp.is-curtain{display:block;padding:0;overflow:hidden;cursor:ew-resize;touch-action:none;user-select:none}
${W} .pk-ops-pane{position:relative;height:clamp(200px,46vh,600px);border-radius:var(--pk-radius-sm);background:#000;overflow:hidden;min-width:0}
${W} .pk-ops-cmp.is-curtain .pk-ops-pane{border-radius:var(--pk-radius)}
${W} .pk-ops-pane video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block;background:transparent}
${W} .pk-ops-clip{position:absolute;inset:0;z-index:1}
${W} .pk-ops-tagv{position:absolute;top:8px;z-index:3;max-width:44%;padding:2px 9px;border-radius:999px;background:rgba(10,14,24,.84);color:#fde68a;font-size:11.5px;font-weight:800;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;pointer-events:none}
${W} .pk-ops-tagv.is-l{left:8px}
${W} .pk-ops-tagv.is-r{right:8px;background:var(--pk-acc);color:var(--pk-acc-ink)}
${W} .pk-ops-div{position:absolute;top:0;bottom:0;z-index:4;width:2px;margin-left:-1px;background:#f59e0b;box-shadow:0 0 12px #f59e0b;pointer-events:none}
${W} .pk-ops-knob{position:absolute;left:50%;top:50%;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:#f59e0b;color:#1a1204;display:grid;place-items:center;box-shadow:0 4px 14px rgba(0,0,0,.5)}
${W} .pk-ops-perr{position:absolute;inset:0;z-index:2;display:flex;align-items:center;justify-content:center;padding:14px;text-align:center;color:#fecaca;font-size:12.5px;line-height:1.6;background:rgba(5,8,15,.82)}
${W} .pk-ops-transport{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-transport .pk-range{flex:1 1 220px;min-width:160px}
${W} .pk-ops-clock{font:700 12px/1 var(--pk-font-mono);color:var(--pk-ink2);white-space:nowrap}
/* teleprompter */
${W} .pk-ops-stage{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:12px;height:clamp(230px,46vh,560px);min-width:0}
${W} .pk-ops-stage.is-solo{grid-template-columns:minmax(0,1fr)}
${W} .pk-ops-vf{position:relative;min-width:0;min-height:0;border-radius:var(--pk-radius);overflow:hidden;background:#05080f;border:1.5px solid var(--pk-line2)}
${W} .pk-ops-vf.is-rec{border-color:#fb7185;box-shadow:0 0 0 2px rgba(251,113,133,.32)}
${W} .pk-ops-vf-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block}
${W} .pk-ops-vf-empty{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:10px;padding:14px 18px;text-align:center;color:#cbd5e1;overflow:auto;overscroll-behavior:contain;background:#05080f}
/* centred with auto margins, not justify-content:center — a message taller than the viewfinder must scroll from its top */
${W} .pk-ops-vf-empty>:first-child{margin-top:auto}
${W} .pk-ops-vf-empty>:last-child{margin-bottom:auto}
${W} .pk-ops-vf-empty>b{max-width:560px;color:#f1f5f9;font-size:13.5px;line-height:1.6;white-space:pre-line;overflow-wrap:anywhere}
${W} .pk-ops-vf-empty.is-err>b{color:#fecaca}
${W} .pk-ops-vf-empty .pk-row{justify-content:center}
${W} .pk-ops-rec{position:absolute;left:10px;bottom:10px;z-index:6;display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:999px;background:rgba(225,29,72,.92);color:#fff;font:800 12.5px/1.25 var(--pk-font-mono);white-space:nowrap}
${W} .pk-ops-rec>i{width:8px;height:8px;border-radius:50%;background:#fff;animation:pk-ops-blink 1s steps(2,start) infinite}
${W} .pk-ops-count{position:absolute;inset:0;z-index:8;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:12px;text-align:center;background:rgba(4,7,14,.72);color:#fff;font-weight:700}
${W} .pk-ops-count>b{font:900 clamp(56px,9vw,104px)/1 var(--pk-font-mono);color:#f5b942}
${W} .pk-ops-pwrap{position:relative;min-width:0;min-height:0;border-radius:var(--pk-radius);overflow:hidden;border:1px solid var(--pk-line2)}
${W} .pk-ops-vf>.pk-ops-pwrap{position:absolute;left:10px;right:10px;top:10px;height:48%;z-index:5;border-color:rgba(255,255,255,.18)}
${W} .pk-ops-pbox{position:absolute;inset:0;overflow-x:hidden;overflow-y:auto;color:#fff;font-weight:700;text-shadow:0 2px 8px rgba(0,0,0,.85);scrollbar-width:thin;outline:none}
${W} .pk-ops-vf .pk-ops-pbox{backdrop-filter:blur(6px)}
${W} .pk-ops-ptext{margin:0;padding:0 18px;white-space:pre-wrap;overflow-wrap:anywhere}
${W} .pk-ops-pad-t{height:24%}
${W} .pk-ops-pad-b{height:72%}
${W} .pk-ops-readline{position:absolute;left:0;right:0;top:24%;z-index:2;border-top:1px solid rgba(245,185,66,.8);border-bottom:1px solid rgba(245,185,66,.8);background:rgba(245,185,66,.08);pointer-events:none}
${W} .pk-ops-vu{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:var(--pk-radius);border:1px solid var(--pk-line);background:var(--pk-bg2);min-width:0}
${W} .pk-ops-vu>span{white-space:nowrap;font-size:12.5px;font-weight:700}
${W} .pk-ops-vu-t{flex:1;min-width:60px;height:8px;border-radius:999px;background:var(--pk-bg3);overflow:hidden}
${W} .pk-ops-vu-t>i{display:block;width:0;height:100%;border-radius:inherit;background:var(--pk-ok);transition:width .08s linear}
${W} .pk-ops-vu-t>i.is-hot{background:var(--pk-warn)}
${W} .pk-ops-vu>b{min-width:40px;text-align:right;font:700 12px/1 var(--pk-font-mono)}
${W} .pk-ops-take{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:var(--pk-radius);border:1px solid color-mix(in srgb,var(--pk-warn) 55%,transparent);background:color-mix(in srgb,var(--pk-warn) 9%,var(--pk-bg2));min-width:0}
${W} .pk-ops-take video{display:block;width:100%;max-height:min(42vh,380px);background:#000;border-radius:var(--pk-radius-sm)}
${W} .pk-ops-sliders{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(200px,100%),1fr));gap:10px 14px}
@keyframes pk-ops-blink{to{visibility:hidden}}
@container pkbody (max-width: 760px){
  ${W} .pk-ops-dna{grid-template-columns:minmax(0,1fr)}
}
@container pkbody (max-width: 600px){
  ${W} .pk-ops-tasks{grid-template-columns:minmax(0,1fr)}
  ${W} .pk-ops-runlist{position:static;max-height:250px;padding:6px;border:1px solid var(--pk-line);border-radius:var(--pk-radius)}
}
@container pkbody (max-width: 680px){
  ${W} .pk-ops-cmp:not(.is-curtain){grid-template-columns:minmax(0,1fr)}
  ${W} .pk-ops-cmp:not(.is-curtain) .pk-ops-pane{height:clamp(170px,34vh,380px)}
  ${W} .pk-ops-stage{grid-template-columns:minmax(0,1fr);height:auto}
  ${W} .pk-ops-stage>.pk-ops-vf,${W} .pk-ops-stage>.pk-ops-pwrap{height:clamp(200px,40vh,420px)}
}
@media (prefers-reduced-motion: reduce){${W} .pk-ops-rec>i{animation:none}}
`
  ;(function injectCss() {
    try {
      if (document.getElementById('pk-ops-css')) return
      const st = document.createElement('style')
      st.id = 'pk-ops-css'
      st.textContent = CSS
      const head = document.head || document.documentElement
      head.insertBefore(st, head.firstChild) // first in <head>: every skin rule (kit.css, skin <style>) comes later and wins
    } catch (err) {
      console.error('[PK] 80-ops styles failed', err)
    }
  })()

  /* ================================================================ shared helpers */
  const num = U.num
  const pct = (v) => U.clamp(Math.round(num(v)), 0, 100)
  const p2 = (x) => String(x).padStart(2, '0')
  const hms = (v) => {
    const d = new Date(typeof v === 'number' ? v : String(v || ''))
    return Number.isNaN(d.getTime()) ? '--:--:--' : `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  }
  const durMs = (ms) => U.fmtDur(num(ms) / 1000)
  const clock = (sec) => {
    const s = Math.max(0, num(sec))
    return `${p2(Math.floor(s / 60))}:${p2(Math.floor(s % 60))}.${Math.floor((s * 10) % 10)}`
  }
  const finite = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
  const st = () => PK.state || {}
  const curDirector = () => st().director || {}
  const dirKey = () => PK.dir() || ''

  /** stable same-origin URL of a project file (cache-busted only by the caller's own version key, never by every host refresh) */
  const fileUrl = (rel, v) => (PK.dir() && rel ? `/api/video-workbench/asset?projectDir=${encodeURIComponent(PK.dir())}&rel=${encodeURIComponent(rel)}&v=${encodeURIComponent(String(v || '0'))}` : '')

  /** beginner-friendly translation of raw pipeline / API errors (port of the classic translateBeginnerError) */
  function explainError(raw) {
    const msg = String(raw || '').trim()
    if (!msg) return { title: '操作遇到问题', detail: '', action: '' }
    const low = msg.toLowerCase()
    if (/402|insufficient_quota|insufficient balance|余额不足|欠费|账户余额|billing/.test(low))
      return { title: '账户余额不足或欠费 — 已自动停止，不会自动重试以免重复扣费；请先到对应平台充值，再点「重新执行」', detail: msg, action: 'open-llm' }
    if (/401|403|unauthorized|api key|未配置|invalid x-api-key/.test(low))
      return { title: '模型密钥 (API Key) 未设置或无效 — 请到「设置 · 模型与密钥」核对密钥，或改用「本地极速草稿」零配置先出片', detail: msg, action: 'open-llm' }
    if (/429|quota|rate limit|余额/.test(low)) return { title: '模型接口请求过于频繁或额度不足 — 请更换模型、稍后重试，或改用「本地极速草稿」继续创作', detail: msg, action: 'open-llm' }
    if (/enotfound|econnrefused|fetch failed|networkerror|timed out|timeout/.test(low))
      return { title: '网络连接大模型或本地服务超时 — 请检查网络代理设置或 API Base URL 地址是否正确', detail: msg, action: 'open-llm' }
    if (/no assets|暂无可用素材/.test(low)) return { title: '当前工程还没有画面素材 — 先导入素材，或一键加载新手演示素材再试', detail: msg, action: 'load-starter' }
    return { title: msg, detail: '', action: '' }
  }

  /** re-render without stealing a click: wait while a pointer is pressed inside the panel or a popover is open */
  function armRenderGuard(ctx) {
    const L = ctx.local
    const down = (ev) => {
      if (ctx.frame.el.contains(ev.target)) L.__pd = true
    }
    const up = () => {
      if (!L.__pd) return
      L.__pd = false
      if (L.__pending) {
        L.__pending = false
        setTimeout(() => ctx.update(), 40)
      }
    }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', up, true)
    ctx.onCleanup(() => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', up, true)
    })
  }
  function liveUpdate(ctx) {
    const L = ctx.local
    if (L.__pd || document.querySelector('#pk-root .pk-pop')) {
      L.__pending = true
      return
    }
    ctx.update()
  }

  /** persistent <video> elements survive re-renders (moved, never re-created) so playback is never interrupted */
  function releaseMedia(el) {
    if (!el) return
    try {
      el.pause()
    } catch {}
    try {
      if (el.srcObject) el.srcObject = null
    } catch {}
    try {
      el.removeAttribute('src')
      el.load()
    } catch {}
  }
  function keepVideo(ctx, key, src, init) {
    const m = (ctx.local.__media = ctx.local.__media || {})
    let v = m[key]
    if (v && v.__src !== src) {
      releaseMedia(v)
      v = null
    }
    if (!v) {
      v = document.createElement('video')
      v.__src = src
      v.preload = 'metadata'
      v.playsInline = true
      v.setAttribute('playsinline', '')
      if (init) init(v)
      if (src) v.src = src
      m[key] = v
    }
    return v
  }
  function dropVideo(ctx, key) {
    const m = ctx.local.__media || {}
    if (m[key]) {
      releaseMedia(m[key])
      delete m[key]
    }
  }
  function releaseAllMedia(ctx) {
    for (const v of Object.values(ctx.local.__media || {})) releaseMedia(v)
    ctx.local.__media = {}
  }

  /** a read-only full-screen viewer for long text (MOTION.md, logs …) — always shows everything, with copy */
  function openTextViewer(title, en, text, opts = {}) {
    const f = PK.frame({ kind: 'modal', size: 'xl', title, en: en || 'VIEWER', class: 'pk-ops-viewer' })
    PK.append(f.body, opts.hint ? ui.hint(opts.hint) : null, ui.code(text || '（空）', { class: 'pk-ops-md-full' }))
    f.setFoot([
      ui.hint(`${U.countChars(text || '')} 字`),
      ui.spacer(),
      ui.btn('复制全文', async () => {
        const ok = await U.copyText(text || '')
        PK.toast(ok ? '已复制到剪贴板' : '复制失败，请手动选择文本复制', ok ? 'success' : 'warn')
      }, { icon: 'copy' }),
      ui.btn('关闭', () => f.close('ok'), { kind: 'primary' }),
    ])
    return f
  }
  function openImageViewer(title, src, en) {
    const f = PK.frame({ kind: 'modal', size: 'xl', title, en: en || 'PREVIEW' })
    PK.append(f.body, h('div.pk-ops-player', null, h('img', { src, alt: title, draggable: 'false' })))
    f.setFoot([ui.spacer(), ui.btn('关闭', () => f.close('ok'), { kind: 'primary' })])
    return f
  }

  /* ================================================================ 1 · 任务中心 TASK CENTER */
  const RUN_STATUS = {
    running: ['运行中', 'acc'],
    queued: ['排队中', 'mute'],
    idle: ['待命中', 'mute'],
    paused: ['已暂停', 'warn'],
    completed: ['已完成', 'ok'],
    failed: ['需处理', 'err'],
    stopped: ['已停止', 'err'],
  }
  const runStatus = (s) => RUN_STATUS[s] || ['待命中', 'mute']
  const isLive = (s) => s === 'running' || s === 'paused' || s === 'queued' || s === 'idle'
  const AGENT_STATUS = {
    idle: ['待命', 'mute'],
    queued: ['排队', 'mute'],
    running: ['工作中', 'acc'],
    paused: ['已暂停', 'warn'],
    done: ['完成', 'ok'],
    completed: ['完成', 'ok'],
    failed: ['失败', 'err'],
    stopped: ['已停止', 'err'],
    skipped: ['本次跳过', 'mute'],
  }
  const AGENT_NAMES = { director: '策划导演', editor: '素材剪辑', audio: '配音混音', motion: '动效编程', qa: '质检渲染', avatar: '数字人', cloud: '云端生成', reference: '参考复刻', system: '系统' }
  const agentName = (id) => {
    const a = (st().agents || []).find((x) => x && x.id === id)
    return (a && a.name) || AGENT_NAMES[id] || String(id || '系统')
  }
  const TASK_AGENT = { 't-director': 'director', 't-editor': 'editor', 't-audio': 'audio', 't-avatar': 'avatar', 't-motion': 'motion', 't-render': 'qa' }
  const logAgent = (lg) => {
    const stage = String((lg && lg.stage) || '')
    const text = String((lg && lg.message) || '')
    if (stage === 'director' || stage === 'editor' || stage === 'avatar') return stage
    if (stage === 'audio') return /数字人|口型|唇形|avatar|lipsync/i.test(text) ? 'avatar' : 'audio'
    if (stage === 'motion_qa' || stage === 'motion' || stage === 'render') return /渲染|MP4|导出|成品|编码|响度|质检报告/i.test(text) ? 'qa' : 'motion'
    return 'system'
  }
  const runModeLabel = (r) => (/draft/i.test(String((r && r.mode) || '')) ? '极速本地出片' : 'AI 团队协同出片')
  const CONTROL_OK = { pause: '已暂停任务', resume: '已恢复执行', stop: '已停止任务与子进程', retry: '已发起重新执行', 'pause-all': '已全部暂停', 'stop-all': '已紧急停止全部任务' }
  const BILLING_GUIDE = '为避免重复扣费，系统不会自己重跑。请先到对应平台充值，再点「重新执行」；已完成的步骤与已付费的云端素材会被复用。'

  function runSignature(ctx) {
    const L = ctx.local
    const runs = L.runs || []
    const s = st()
    return JSON.stringify([
      L.err ? String(L.err.message || L.err) : '',
      runs.map((r) => [r.id, r.status, r.progress, Math.floor(num(r.elapsedMs) / 1000), r.error, r.errorKind, (r.tasks || []).map((t) => [t.status, t.progress, t.message, t.error]), (r.logs || []).length]),
      s.run && [s.run.id, s.run.status, s.run.activeAgentId],
      (s.agents || []).map((a) => [a.status, a.progress, a.message]),
      s.preview && s.preview.hasMp4,
    ])
  }

  function setupTaskFetch(ctx) {
    const L = ctx.local
    L.fetch = (force) => {
      if (ctx.frame.closed) return
      if (L.inflight) {
        L.again = true
        return
      }
      const wait = force ? 0 : Math.max(0, 650 - (Date.now() - (L.lastFetch || 0)))
      if (wait > 0) {
        if (!L.timer) L.timer = setTimeout(() => {
          L.timer = 0
          L.fetch()
        }, wait)
        return
      }
      const dir = dirKey()
      if (!dir) return
      L.inflight = true
      L.lastFetch = Date.now()
      PK.get('tasks', { projectDir: dir })
        .then((d) => {
          if (dir !== dirKey()) return
          L.runs = Array.isArray(d && d.runs) ? d.runs : []
          L.err = null
        })
        .catch((err) => {
          L.err = err
        })
        .finally(() => {
          L.inflight = false
          const sig = runSignature(ctx)
          if (sig !== L.sig) {
            L.sig = sig
            liveUpdate(ctx)
          }
          if (L.again) {
            L.again = false
            L.fetch()
          }
        })
    }
    ctx.onCleanup(() => clearTimeout(L.timer))
  }

  async function taskControl(ctx, run, action, taskId) {
    const s = st()
    const hostRun = s.run && s.run.id
    const simple = action === 'pause' || action === 'resume' || action === 'stop' || action === 'retry'
    if (simple && !taskId && hostRun && run && run.id === hostRun) {
      // the host keeps its own task state in sync and shows its own result toast
      try {
        await PK.action(action, {})
      } catch (err) {
        if (!/任务控制指令执行失败/.test(String(err && err.message))) throw err
      }
    } else {
      await PK.post('tasks/control', { action, runId: run ? run.id : '', projectDir: PK.needProject(), taskId: taskId || '' })
      PK.toast(CONTROL_OK[action] || '操作成功', action.indexOf('stop') >= 0 ? 'info' : 'success')
    }
    ctx.local.fetch(true)
  }

  async function confirmRetry(run, task) {
    const billing = run.errorKind === 'billing'
    const draft = /draft/i.test(String(run.mode || ''))
    const parts = []
    if (task) parts.push(`将从「${task.name || task.id}」重新执行，并重做它之后的全部步骤。`)
    else if (run.status === 'completed') parts.push('将重新执行整条出片流水线，新成片会覆盖当前的 output/final.mp4。')
    else parts.push('将从失败 / 停止的步骤继续执行，已完成的步骤会被复用。')
    if (billing) parts.push('这次任务是因为账户余额不足而停止的：请先确认已经到对应平台充值，否则会再次停止。')
    parts.push(draft ? '本地极速草稿模式，不消耗大模型额度。' : 'AI 团队协同模式会再次调用大模型 / 云端服务（会消耗少量额度）。')
    return PK.confirm({ title: task ? '从这一步重新执行？' : '重新执行这次出片？', text: parts.join('\n'), ok: '重新执行' })
  }

  function taskAgentsStrip() {
    const agents = st().agents || []
    if (!agents.length) return null
    return h(
      'div.pk-ops-agents',
      null,
      agents.map((a) => {
        const [lbl, tone] = AGENT_STATUS[a.status] || ['待命', 'mute']
        return h(
          'div.pk-ops-agent',
          { class: `is-${a.status || 'idle'}` },
          h('div.pk-ops-agent-h', null, h('b', { title: `${a.name}${a.en ? ` · ${a.en}` : ''}` }, a.name || AGENT_NAMES[a.id] || a.id), ui.pill(lbl, tone)),
          a.status === 'running' || a.status === 'paused' ? ui.meter(pct(a.progress), { tone: a.status === 'paused' ? 'warn' : '' }) : null,
          a.message ? h('p', null, a.message) : null,
        )
      }),
    )
  }

  const logText = (run) => (run.logs || []).map((lg) => `[${hms(lg.ts)}] [${agentName(logAgent(lg))}] ${lg.message || ''}`).join('\n')

  function runLogBox(ctx, run) {
    const L = ctx.local
    const onlyIssues = L.logFilter === 'issues'
    const all = Array.isArray(run.logs) ? run.logs : []
    const lines = onlyIssues ? all.filter((lg) => lg && /error|warn/.test(String(lg.level || ''))) : all
    const box = h(
      'div.pk-log.pk-ops-log',
      { role: 'log', 'aria-label': '执行日志', 'data-pk-scroll': `tasks-log-${run.id}`, tabindex: '0' },
      lines.length
        ? lines.map((lg) => {
            const lvl = lg.level === 'error' ? 'error' : /warn/.test(String(lg.level || '')) ? 'warn' : 'info'
            const who = agentName(logAgent(lg))
            return h('div.pk-log-l', { class: `is-${lvl}` }, h('time', null, hms(lg.ts)), h('em', { title: who }, who), h('span', null, String(lg.message || '')))
          })
        : h('div.pk-log-l', null, h('span', null, onlyIssues ? '这次运行没有警告或错误 👍' : '暂无日志')),
    )
    box.addEventListener('scroll', () => {
      L.logStick = box.scrollTop + box.clientHeight >= box.scrollHeight - 14
    })
    if (L.logStick !== false) requestAnimationFrame(() => (box.scrollTop = box.scrollHeight))
    return box
  }

  function runResult(ctx, run, isLatestDone) {
    const L = ctx.local
    const s = st()
    const qa = (run.resultSummary && run.resultSummary.qa) || {}
    const vm = qa.videoMeta || {}
    const loud = qa.loudness || {}
    const hasMp4 = Boolean(s.preview && s.preview.hasMp4)
    const pairs = [
      vm.width && vm.height ? ['分辨率', `${vm.width} × ${vm.height}`] : null,
      vm.durationSec ? ['成片时长', `${num(vm.durationSec).toFixed(1)} 秒`] : null,
      Number.isFinite(Number(loud.integratedLufs)) ? ['整体响度', `${num(loud.integratedLufs).toFixed(1)} LUFS`] : null,
      Number.isFinite(Number(loud.truePeakDbtp)) ? ['真峰值', `${num(loud.truePeakDbtp).toFixed(1)} dBTP`] : null,
      qa.passed !== undefined ? ['自动质检', qa.passed ? '通过' : '有待处理的问题（详见交付面板）'] : null,
    ].filter(Boolean)
    const showing = L.play === run.id && hasMp4
    let player = null
    if (showing) {
      const src = fileUrl('output/final.mp4', L.mp4v || (s.run && s.run.id) || 'cur')
      const v = keepVideo(ctx, 'final', src, (el) => {
        el.controls = true
        el.preload = 'auto'
        if (s.preview && s.preview.posterUrl) el.poster = s.preview.posterUrl
        el.addEventListener('error', () => PK.toast('成片无法播放：文件可能正在重新渲染或已被移动', 'warn'))
      })
      player = h('div.pk-ops-player', { class: { 'is-vertical': vm.height > vm.width } }, v)
    } else dropVideo(ctx, 'final')
    return ui.section(
      { title: '成片', en: 'RESULT', icon: 'film' },
      pairs.length ? ui.kv(pairs) : null,
      !hasMp4 ? ui.note('工程里暂时没有可播放的成片文件（output/final.mp4），可能已被删除或正在重新渲染。', { level: 'warn' }) : null,
      hasMp4 && !isLatestDone ? ui.hint('提示：每次出片都会覆盖 output/final.mp4，这里播放的是工程当前最新的成片。') : null,
      player,
      ui.row([
        hasMp4
          ? ui.btn(showing ? '收起播放器' : '播放成片', () => {
              L.play = showing ? '' : run.id
              ctx.render()
            }, { icon: showing ? 'collapse' : 'play', kind: showing ? 'secondary' : 'primary' })
          : null,
        ui.btn('去交付面板（导出 / 发布包）', () => PK.open('studio', { step: 'delivery' }), { icon: 'box' }),
      ]),
    )
  }

  function runDetail(ctx, run, runs) {
    const L = ctx.local
    const s = st()
    const [lbl, tone] = runStatus(run.status)
    const isCurrent = Boolean(s.run && s.run.id === run.id)
    const billing = run.errorKind === 'billing'
    const p = run.status === 'completed' ? 100 : pct(run.progress)
    const latestDone = runs.find((r) => r.status === 'completed')
    const ctl = (label, action, o = {}) =>
      ui.btn(label, async () => {
        if (action === 'stop') {
          const ok = await PK.confirm({ title: '停止这次出片？', text: '会立即中止正在运行的步骤和子进程。已完成的步骤会保留，之后可以点「重新执行」从停下的地方继续。', ok: '停止任务', danger: true })
          if (!ok) return
        }
        if (action === 'retry' && !(await confirmRetry(run))) return
        await taskControl(ctx, run, action)
      }, { busyText: o.busy || '处理中…', ...o })
    const controls = [
      run.status === 'paused' || run.status === 'queued' ? ctl('恢复执行', 'resume', { icon: 'play', kind: 'primary', busy: '恢复中…' }) : null,
      run.status === 'running' ? ctl('暂停', 'pause', { icon: 'pause', busy: '暂停中…' }) : null,
      run.status === 'running' || run.status === 'paused' ? ctl('停止', 'stop', { icon: 'stop', kind: 'danger', busy: '停止中…' }) : null,
      ['stopped', 'failed', 'completed'].includes(run.status) ? ctl('重新执行', 'retry', { icon: 'retry', kind: run.status === 'completed' ? 'secondary' : 'primary', busy: '启动中…' }) : null,
    ]
    let errNode = null
    if (billing) {
      const bs = run.billingStop || {}
      const scope = String(bs.scope || '')
      errNode = ui.note(
        h(
          'div',
          null,
          h('p.pk-ops-msg', null, String(bs.message || run.error || '账户余额不足')),
          h('p.pk-ops-msg', null, h('b', null, '不会自动重试，充值后可重新执行。'), BILLING_GUIDE),
          bs.provider || bs.status ? h('p.pk-ops-sub', null, [bs.provider ? `服务：${bs.provider}` : '', bs.status ? `HTTP ${bs.status}` : '', bs.providerCode ? `代码：${bs.providerCode}` : ''].filter(Boolean).join(' · ')) : null,
        ),
        {
          level: 'error',
          title: '计费停止：账户余额不足或欠费，本次任务已自动停止',
          actions: [
            scope === 'cloud' ? ui.btn('查看云端媒体设置', () => PK.open('cloud'), { size: 'sm', icon: 'cloud' }) : null,
            scope === 'tts' ? ui.btn('查看配音引擎设置', () => PK.open('keys', { tab: 'tts' }), { size: 'sm', icon: 'voice' }) : null,
            scope !== 'cloud' && scope !== 'tts' ? ui.btn('查看模型与密钥', () => PK.open('keys', { tab: 'llm' }), { size: 'sm', icon: 'key' }) : null,
          ],
        },
      )
    } else if (run.error) {
      const e = explainError(run.error)
      errNode = ui.note(
        h('div', null, e.detail ? h('details', null, h('summary', null, '技术细节'), h('p.pk-ops-msg', null, e.detail)) : null),
        {
          level: run.status === 'stopped' ? 'warn' : 'error',
          title: e.title,
          actions:
            e.action === 'open-llm'
              ? [ui.btn('去设置 · 模型与密钥', () => PK.open('keys', { tab: 'llm' }), { size: 'sm', icon: 'key' })]
              : e.action === 'load-starter'
                ? [ui.btn('一键加载演示素材', () => PK.postP('assets/starter-pack', {}).then(() => PK.toast('演示素材已载入', 'success')), { size: 'sm', icon: 'download', busyText: '载入中…' })]
                : null,
        },
      )
    }
    const tasks = Array.isArray(run.tasks) ? run.tasks : []
    const stepRetryOk = ['stopped', 'failed', 'completed'].includes(run.status)
    const steps = tasks.map((t, i) => {
      const [tl, tt] = runStatus(t.status)
      const tp = t.status === 'completed' ? 100 : pct(t.progress)
      const agent = TASK_AGENT[t.id] ? agentName(TASK_AGENT[t.id]) : ''
      const timing = [t.startedAt ? `开始 ${hms(t.startedAt)}` : '', t.elapsedMs ? `用时 ${durMs(t.elapsedMs)}` : '', t.endedAt && t.status !== 'running' ? `结束 ${hms(t.endedAt)}` : ''].filter(Boolean).join(' · ')
      return h(
        'div.pk-ops-step',
        { class: `is-${t.status || 'queued'}` },
        h('div.pk-ops-step-t', null, h('span.pk-ops-step-n', null, String(i + 1)), h('b', null, t.name || t.id), agent ? ui.tag(agent) : null, ui.pill(tl, tt)),
        ui.btn('从此重试', async () => {
          if (!(await confirmRetry(run, t))) return
          await taskControl(ctx, run, 'retry', t.id)
        }, { size: 'sm', icon: 'retry', disabled: !stepRetryOk, title: stepRetryOk ? `从「${t.name}」重新执行` : '任务运行中，结束或停止后才能从某一步重试', busyText: '启动中…' }),
        h(
          'div.pk-ops-step-m',
          null,
          t.status === 'running' || t.status === 'paused' || (tp > 0 && tp < 100) ? ui.meter(tp, { tone: t.status === 'paused' ? 'warn' : t.status === 'failed' ? 'err' : '' }) : null,
          t.error ? h('p.pk-ops-msg.is-err', null, t.error) : t.message ? h('p.pk-ops-msg', null, t.message) : null,
          timing ? h('p.pk-ops-sub.pk-ops-mono', null, timing) : null,
        ),
      )
    })
    const created = run.createdAt ? U.fmtTime(run.createdAt) : ''
    return h(
      'div.pk-ops-detail',
      { key: `run-${run.id}` },
      h(
        'div.pk-ops-dh',
        null,
        h('b.pk-ops-big', null, `${p}%`),
        h(
          'div.pk-ops-dh-t',
          null,
          h('h3.pk-ops-h3', null, run.title || run.id),
          h('p.pk-ops-sub', null, [runModeLabel(run), created ? `创建于 ${created}` : '', `耗时 ${durMs(run.elapsedMs)}`].filter(Boolean).join(' · ')),
          h('p.pk-ops-sub.pk-ops-mono', { title: '运行编号' }, run.id),
        ),
        ui.row([billing ? ui.pill('计费停止', 'err', { dot: true }) : null, ui.pill(lbl, tone, { dot: true }), isCurrent ? ui.pill('当前工程最新任务', 'acc') : null], { end: true }),
      ),
      ui.meter(p, { tone: run.status === 'failed' || run.status === 'stopped' ? 'err' : run.status === 'paused' ? 'warn' : run.status === 'completed' ? 'ok' : '', indeterminate: run.status === 'queued' }),
      controls.some(Boolean) ? ui.row(controls) : null,
      errNode,
      isCurrent && isLive(run.status) && s.run && s.run.message ? ui.note(s.run.message, { level: 'info', title: `进行中 · ${agentName(s.run.activeAgentId || 'director')}` }) : null,
      run.status === 'completed' ? runResult(ctx, run, latestDone && latestDone.id === run.id) : null,
      isCurrent && run.status !== 'completed' ? ui.section({ title: '8 位 AI Agent 实时状态', en: 'AGENTS', icon: 'user' }, taskAgentsStrip()) : null,
      ui.section({ title: '分步子任务进度', en: 'STAGES', icon: 'layers', count: tasks.length }, tasks.length ? h('div.pk-ops-steps', null, steps) : ui.hint('这次运行没有记录子任务。')),
      ui.section(
        { title: '执行日志', en: 'LOG', icon: 'list', count: (run.logs || []).length },
        // controls live in their own wrapping toolbar (in the section header they squeezed the title at 1100 px)
        h(
          'div.pk-ops-toolbar',
          null,
          ui.seg({ value: L.logFilter || 'all', aria: '日志筛选', options: [{ value: 'all', label: '全部' }, { value: 'issues', label: '仅警告与错误' }], onChange: (v) => ((L.logFilter = v), (L.logStick = true), ctx.render()) }),
          ui.spacer(),
          ui.btn('复制日志', async () => {
            const ok = await U.copyText(logText(run))
            PK.toast(ok ? '日志已复制，可以直接粘贴给客服或开发者' : '复制失败', ok ? 'success' : 'warn')
          }, { size: 'sm', icon: 'copy' }),
          ui.btn('放大查看', () => openTextViewer(`执行日志 · ${run.title || run.id}`, 'RUN LOG', logText(run)), { size: 'sm', icon: 'expand' }),
        ),
        runLogBox(ctx, run),
      ),
    )
  }

  async function startNewRun(ctx) {
    PK.needProject()
    const d = curDirector()
    const draft = d.creationMode === 'fast-draft'
    const topic = String(d.topic || '').trim()
    const ok = await PK.confirm({
      title: '启动一键出片？',
      text: h(
        'div',
        null,
        h('p.pk-text', null, `创作模式：${draft ? '本地极速草稿（零配置、不消耗额度）' : 'AI 团队协同（会调用大模型，消耗少量额度）'}`),
        h('p.pk-text.pk-text--muted', null, topic ? `创意需求：${U.trimText(topic, 120)}` : '还没有写创意需求，AI 会按工程标题和素材自动构思。'),
      ),
      ok: '立即出片',
    })
    if (!ok) return
    await PK.action('run', topic ? { topic } : {})
    ctx.local.sel = ''
    ctx.local.fetch(true)
  }

  PK.panel('tasks', {
    title: '任务中心',
    en: 'TASK CENTER · 出片任务 · 运行记录 · 实时日志',
    idx: '04',
    icon: 'tasks',
    kind: 'drawer',
    size: 'lg',
    group: 'main',
    order: 30,
    desc: '出片进度、暂停 / 停止 / 重试、完整日志与成片',
    needsProject: true,
    aliases: { task: {}, taskCenter: {}, runs: {}, jobs: {} },
    watch: (s) => {
      const r = s && s.run
      const logs = (s && s.logs) || []
      const last = logs[logs.length - 1]
      return [s && s.project && s.project.dir, s && s.rev, r && r.id, r && r.status, r && r.progress, r && r.activeAgentId, logs.length, last && last.ts, ((s && s.agents) || []).map((a) => `${a.status}:${a.progress}`)]
    },
    onWatch(ctx) {
      const L = ctx.local
      if (!PK.hasProject()) {
        ctx.close()
        return
      }
      if (L.dir !== dirKey()) {
        L.dir = dirKey()
        L.sel = ''
        L.runs = null
        L.sig = ''
        ctx.render()
        L.fetch(true)
        return
      }
      L.fetch()
    },
    mount(ctx) {
      const L = ctx.local
      L.dir = dirKey()
      L.filter = ctx.args.filter || 'all'
      L.sel = ctx.args.runId || ''
      L.logFilter = 'all'
      L.logStick = true
      setupTaskFetch(ctx)
      armRenderGuard(ctx)
      L.fetch(true)
      ctx.every(1200, () => {
        const live = (L.runs || []).some((r) => isLive(r.status)) || (st().run && isLive(st().run.status))
        if (live || Date.now() - (L.lastFetch || 0) > 6000) L.fetch()
      })
      ctx.listen('event:run-started', (d) => {
        if (d && d.runId) L.sel = d.runId
        L.fetch(true)
      })
      ctx.listen('event:run-finished', (d) => {
        if (d && d.status === 'completed') L.mp4v = d.runId || String(Date.now())
        L.fetch(true)
      })
    },
    onArgs(ctx, a) {
      if (a.runId) ctx.local.sel = a.runId
      if (a.filter) ctx.local.filter = a.filter
      ctx.render()
    },
    unmount(ctx) {
      releaseAllMedia(ctx)
    },
    render(ctx) {
      const L = ctx.local
      const runs = L.runs
      const s = st()
      const anyLive = (runs || []).some((r) => isLive(r.status)) || Boolean(s.run && isLive(s.run.status))
      ctx.foot([
        ui.hint(runs ? `共 ${runs.length} 次出片${anyLive ? ' · 实时刷新中' : ''}` : '正在读取…'),
        ui.spacer(),
        ui.btn('分步精修', () => PK.open('studio'), { icon: 'layers', kind: 'ghost' }),
        ui.btn('新建一键任务', () => startNewRun(ctx), { kind: 'primary', icon: 'bolt', busyText: '启动中…', disabled: anyLive, title: anyLive ? '已有任务在运行，可先暂停或停止' : '用当前的创意需求和导演参数启动一键出片' }),
      ])
      if (!runs) return L.err ? ui.errorBox(L.err, () => L.fetch(true)) : ui.loading('正在读取出片任务…')
      if (!runs.length)
        return ui.empty({
          icon: 'tasks',
          title: '这个工程还没有出片任务',
          text: '在作战大屏写下创意需求后点「一键出片」，8 位 AI Agent 的每一步进度、日志和成片都会实时出现在这里，可随时暂停、停止或重试。',
          actions: [ui.btn('写创意需求', () => PK.editTopic(), { icon: 'edit' }), ui.btn('新建一键任务', () => startNewRun(ctx), { kind: 'primary', icon: 'bolt', busyText: '启动中…' })],
        })
      const counts = {
        running: runs.filter((r) => isLive(r.status)).length,
        completed: runs.filter((r) => r.status === 'completed').length,
        failed: runs.filter((r) => r.status === 'failed' || r.status === 'stopped').length,
      }
      const shown = runs.filter((r) =>
        L.filter === 'running' ? isLive(r.status) : L.filter === 'completed' ? r.status === 'completed' : L.filter === 'failed' ? r.status === 'failed' || r.status === 'stopped' : true,
      )
      if (!L.sel || !runs.some((r) => r.id === L.sel)) {
        const live = runs.find((r) => isLive(r.status))
        L.sel = (live && live.id) || (s.run && runs.some((r) => r.id === s.run.id) ? s.run.id : runs[0].id)
      }
      const sel = runs.find((r) => r.id === L.sel) || runs[0]
      const runLive = runs.some((r) => r.status === 'running')
      const runPaused = runs.some((r) => isLive(r.status))
      const toolbar = h(
        'div.pk-ops-toolbar',
        null,
        ui.seg({
          value: L.filter,
          aria: '筛选任务',
          options: [
            { value: 'all', label: `全部 ${runs.length}` },
            { value: 'running', label: `进行中 ${counts.running}` },
            { value: 'completed', label: `已完成 ${counts.completed}` },
            { value: 'failed', label: `异常 ${counts.failed}` },
          ],
          onChange: (v) => {
            L.filter = v
            ctx.render()
          },
        }),
        ui.spacer(),
        ui.btn('全部暂停', () => taskControl(ctx, null, 'pause-all'), { icon: 'pause', size: 'sm', disabled: !runLive, busyText: '暂停中…', title: '暂停这个工程里所有正在运行的任务' }),
        ui.btn('紧急全部停止', async () => {
          const ok = await PK.confirm({ title: '紧急停止全部任务？', text: '会立即中止这个工程里所有运行中 / 暂停中 / 排队中的任务和它们的子进程。已完成的步骤会保留，之后可以逐个「重新执行」。', ok: '全部停止', danger: true })
          if (ok) await taskControl(ctx, null, 'stop-all')
        }, { icon: 'stop', size: 'sm', kind: 'danger', disabled: !runPaused, busyText: '停止中…' }),
        ui.iconBtn('refresh', () => L.fetch(true), { title: '立即刷新' }),
      )
      const list = h(
        'div.pk-ops-runlist',
        { 'data-pk-scroll': 'tasks-runs', role: 'list' },
        shown.length
          ? shown.map((r) => {
              const [rl, rt] = runStatus(r.status)
              const rp = r.status === 'completed' ? 100 : pct(r.progress)
              return ui.item({
                key: `run-item-${r.id}`,
                title: r.title || r.id,
                sub: [r.createdAt ? U.fmtTime(r.createdAt) : '', `耗时 ${durMs(r.elapsedMs)}`, `${rp}%`].filter(Boolean).join(' · '),
                body: h(
                  'div.pk-ops-runmeta',
                  null,
                  r.errorKind === 'billing' ? ui.pill('计费停止', 'err') : ui.pill(rl, rt),
                  ui.meter(rp, { tone: r.status === 'failed' || r.status === 'stopped' ? 'err' : r.status === 'paused' ? 'warn' : r.status === 'completed' ? 'ok' : '', indeterminate: r.status === 'queued' }),
                ),
                active: r.id === sel.id,
                tone: r.status === 'failed' ? 'err' : r.status === 'paused' ? 'warn' : '',
                tip: r.title || r.id,
                onClick: () => {
                  if (L.sel === r.id) return
                  L.sel = r.id
                  L.logStick = true
                  L.play = ''
                  ctx.render()
                },
              })
            })
          : ui.hint('没有符合条件的任务'),
      )
      return [toolbar, h('div.pk-ops-tasks', null, list, runDetail(ctx, sel, runs))]
    },
  })

  /* ================================================================ 2 · 影核广场 CINEPULSE HUB */
  const PLAZA_FALLBACK_CATS = [
    { id: 'all', label: '全部模板' },
    { id: 'history-theater', label: '历史高燃卡点' },
    { id: 'product-promo', label: '科技产品发布会' },
    { id: 'ui-tutorial', label: 'SaaS / 软件教程' },
    { id: 'science-explainer', label: '深度科普拆解' },
    { id: 'data-story', label: '数据榜单洞察' },
    { id: 'custom', label: '社区 / 我的发布' },
  ]
  const PALETTE_NAMES = { background: '背景', primary: '主色', accent: '强调', highlight: '高光', text: '文字', secondary: '辅色' }
  const TRANSITION_NAMES = {
    'flash-cut': '闪白切',
    'slash-wipe': '斜劈擦除',
    'zoom-punch': '冲击推拉',
    'glitch-cut': '故障切',
    'light-wipe': '光扫转场',
    cut: '硬切',
    crossfade: '交叉淡化',
    fade: '淡入淡出',
    'whip-pan': '甩镜',
    'ink-wipe': '水墨擦除',
    'iris-in': '光圈收放',
    'push-slide': '推移',
    'zoom-blur': '变焦模糊',
  }
  const transitionLabel = (x) => (TRANSITION_NAMES[x] ? `${TRANSITION_NAMES[x]}` : String(x))
  const tplCover = (t) => (t && (t.coverUrl || t.coverFile) ? PK.routeUrl('plaza/cover', { id: t.id }) : '')
  const tplPreview = (t) => (t && (t.previewUrl || t.hasPreview) ? PK.routeUrl('plaza/preview', { id: t.id, v: t.previewBytes || t.previewDurationSec || '' }) : '')
  const tplVertical = (t) => /^9\s*:\s*16$/.test(String((t && t.aspectRatio) || '').trim())
  const tplMetaLine = (t) =>
    [
      t.genreLabel,
      `${t.shotCount || 0} 镜`,
      `${t.bpm || 110} BPM`,
      `全片 ${t.durationSec || 60}s`,
      t.engine === 'html' ? 'HTML5 引擎' : 'Remotion 引擎',
      t.aspectRatio || '16:9',
      t.previewDurationSec ? `样片 ${Math.round(t.previewDurationSec)}s` : '',
    ].filter(Boolean)
  function swatches(palette) {
    const list = Object.entries(palette || {}).filter(([, c]) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim()))
    if (!list.length) return null
    return h('div.pk-ops-swatches', null, list.map(([k, c]) => h('span.pk-ops-sw', { title: `${PALETTE_NAMES[k] || k} ${c}` }, h('i', { style: { background: c } }), `${PALETTE_NAMES[k] || k} ${c.toUpperCase()}`)))
  }

  async function loadPlaza(ctx) {
    const L = ctx.local
    const seq = (L.seq = (L.seq || 0) + 1)
    L.loading = true
    ctx.update()
    try {
      const d = await PK.get('plaza/templates', { category: L.cat || 'all', q: String(L.q || '').trim() })
      if (seq !== L.seq) return
      if (d.brand) L.brand = d.brand
      if (Array.isArray(d.categories) && d.categories.length) L.cats = d.categories
      L.list = Array.isArray(d.templates) ? d.templates : []
      L.total = num(d.totalCount, L.list.length)
      L.onlineCount = num(d.onlineCount)
      L.err = null
    } catch (err) {
      if (seq === L.seq) L.err = err
    } finally {
      if (seq === L.seq) {
        L.loading = false
        ctx.update()
      }
    }
  }
  async function openPlazaDetail(ctx, id) {
    const L = ctx.local
    L.view = 'detail'
    L.detailId = id
    L.detail = null
    L.detailErr = null
    L.player = { needsTap: false, error: '' }
    L.autoplay = true
    ctx.render()
    try {
      const d = await PK.get('plaza/template', { id })
      if (L.detailId === id) L.detail = d
    } catch (err) {
      if (L.detailId === id) L.detailErr = err
    }
    ctx.update()
  }
  function plazaBack(ctx) {
    const L = ctx.local
    dropVideo(ctx, 'plaza')
    L.view = 'grid'
    L.detailId = ''
    L.detail = null
    ctx.setTitle('影核广场', 'CINEPULSE HUB · MOTION.md 模板社区')
    ctx.render()
  }
  async function applyTemplate(ctx, tpl, copyScenes) {
    if (!PK.hasProject()) throw new PK.Error('请先新建或打开一个视频工程，再套用模板', { code: 'no-project' })
    const s = st()
    const proj = (s.project && s.project.title) || '当前工程'
    const sceneCount = ctx.local.detail && ctx.local.detail.template && ctx.local.detail.template.id === tpl.id ? ctx.local.detail.sceneCount : tpl.shotCount
    const ok = await PK.confirm({
      title: copyScenes ? '连同分镜一起套用？' : '套用这个模板的风格基因？',
      text: copyScenes
        ? `会把模板「${tpl.name}」的节奏、配色、转场与 MOTION.md 蓝图写入工程「${proj}」，并用模板的 ${sceneCount || '全部'} 个分镜替换你现在的分镜（当前分镜会被覆盖；如需保留，请先在「版本历史」里存一个快照）。`
        : `会把模板「${tpl.name}」的节奏（${tpl.bpm || 110} BPM · ${tpl.shotCount || 0} 镜）、配色、转场、字幕风格与 MOTION.md 蓝图写入工程「${proj}」。你的素材和现有分镜都会保留，下一次出片就按同款风格复刻。`,
      ok: copyScenes ? '覆盖分镜并套用' : '套用到当前工程',
      danger: Boolean(copyScenes),
    })
    if (!ok) return
    const topic = String(curDirector().topic || '')
    const d = await PK.postP('plaza/apply', { templateId: tpl.id, newTopic: topic, copyScenes: Boolean(copyScenes) })
    try {
      await PK.action('refresh', { syncForm: true })
    } catch {}
    PK.store.invalidate()
    PK.toast(`🏛 已从「${(d && d.plaza) || '影核广场'}」装载模板【${(d && d.templateName) || tpl.name}】与 MOTION.md 蓝图，现在写下你的新主题即可一键同款出片！`, 'success', {
      action: { label: '写新主题', onClick: () => PK.editTopic() },
      timeout: 9000,
    })
    ctx.close()
  }
  async function publishTemplate(ctx) {
    const L = ctx.local
    PK.needProject()
    const script = (L.store && L.store.activeProject && L.store.activeProject.script) || {}
    const defName = String(script.displayTitle || script.title || (st().project && st().project.title) || '我的精选视频模板')
    const name = String(L.pubName || '').trim() || defName
    const tags = String(L.pubTags || '')
      .split(/[,，、;；\s]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 8)
    const hasMp4 = Boolean(st().preview && st().preview.hasMp4)
    const ok = await PK.confirm({
      title: '发布为影核广场模板？',
      text: `会把当前工程的分镜结构、节奏、配色与 MOTION.md 蓝图（不含你的私有素材文件）发布为模板「${name}」${hasMp4 ? '，并自动从成片截取约 15 秒有声样片' : '。当前还没有成片，模板暂不带样片（渲染成片后重新发布即可附带）'}。`,
      ok: '发布',
    })
    if (!ok) return
    const body = { name, description: String(L.pubDesc || '').trim(), category: L.pubCat || script.genre || 'custom' }
    if (tags.length) body.tags = tags
    const d = await PK.postP('plaza/publish', body, { timeout: 600000 })
    const brand = (L.brand && L.brand.displayName) || '影核广场 · CinePulse Hub'
    PK.toast(
      d && d.hasPreview
        ? `✓ 已发布「${(d.template && d.template.name) || name}」到 ${brand}，并自动截取了约 15 秒有声样片，点卡片封面即可播放！`
        : `✓ 已发布「${(d && d.template && d.template.name) || name}」到 ${brand}。${(d && d.previewNote) || ''}`,
      'success',
      { timeout: 9000 },
    )
    L.pubName = ''
    L.pubDesc = ''
    L.pubTags = ''
    L.cat = 'custom'
    L.q = ''
    await loadPlaza(ctx)
  }

  function plazaCard(ctx, t) {
    const cover = tplCover(t)
    const prev = tplPreview(t)
    const img = cover ? h('img', { src: cover, alt: t.name || '', loading: 'lazy', draggable: 'false' }) : null
    if (img)
      img.addEventListener('error', () => {
        img.remove()
      })
    const media = h(
      'button.pk-ops-cover',
      { type: 'button', title: prev ? `点击播放「${t.name}」样片（有声音，可拖动进度）` : `查看「${t.name}」详情与 MOTION.md 蓝图`, 'aria-label': prev ? `播放样片：${t.name}` : `查看详情：${t.name}` },
      h('span.pk-ops-cover-ph', null, PK.icon('film', 30)),
      img,
      h(
        'span.pk-ops-cover-src',
        { class: { 'is-online': t.source === 'online' }, title: t.source === 'online' ? '来自影核广场在线模板库（作者审核收录，点「刷新在线模板」获取）' : null },
        t.source === 'custom' ? '我的发布' : t.source === 'online' ? (t.updatesBuiltin ? '在线更新' : '在线') : '官方精选',
      ),
      prev ? h('span.pk-ops-cover-play', { 'aria-hidden': 'true' }, PK.icon('play', 20)) : null,
      prev ? h('span.pk-ops-cover-len', null, `▶ 样片${t.previewDurationSec ? ` ${Math.round(t.previewDurationSec)}s` : ''}`) : null,
    )
    media.addEventListener('click', () => openPlazaDetail(ctx, t.id))
    return ui.card({
      key: `tpl-${t.id}`,
      media,
      aspect: '16 / 9',
      title: t.name || t.id,
      sub: h('span', { title: t.description || '' }, t.description || '（暂无简介）'),
      body: h('p.pk-ops-meta', null, tplMetaLine(t).join(' · ')),
      tags: (t.tags || []).slice(0, 5),
      actions: [
        ui.btn('一键套用同款', () => applyTemplate(ctx, t, false), { kind: 'primary', size: 'sm', icon: 'wand', busyText: '套用中…', disabled: !PK.hasProject(), title: PK.hasProject() ? '把这个模板的节奏、配色与 MOTION.md 蓝图套用到当前工程' : '先新建或打开一个工程才能套用' }),
        ui.btn(prev ? '样片' : '详情', () => openPlazaDetail(ctx, t.id), { size: 'sm', icon: prev ? 'play' : 'eye' }),
        ui.btn('MOTION.md', () => openPlazaDetail(ctx, t.id), { size: 'sm', kind: 'ghost', icon: 'code' }),
      ],
    })
  }

  function plazaGrid(ctx) {
    const L = ctx.local
    const brand = L.brand || {}
    const cats = (L.cats && L.cats.length ? L.cats : PLAZA_FALLBACK_CATS).map((c) => ({ value: c.id, label: c.label }))
    if (L.onlineCount > 0 || L.cat === 'online') cats.splice(1, 0, { value: 'online', label: `在线新收录 · ${L.onlineCount || 0}` })
    const search = ui.input({
      key: 'plaza-q',
      type: 'search',
      value: L.q || '',
      placeholder: '搜索模板关键词（历史 / 发布会 / 教程 / 科普 / 数据）…',
      onInput: (v) => {
        L.q = v
        L.searchSoon()
      },
      onEnter: () => L.searchSoon.flush(),
    })
    const list = L.list || []
    const store = L.store
    const script = (store && store.activeProject && store.activeProject.script) || {}
    const defName = String(script.displayTitle || script.title || (st().project && st().project.title) || '')
    const pubCats = cats.filter((c) => c.value !== 'all' && c.value !== 'online').map((c) => (c.value === 'custom' ? { value: 'custom', label: '仅放在「我的发布」' } : c))
    if (!L.pubCat) L.pubCat = pubCats.some((c) => c.value === script.genre) ? script.genre : 'custom'
    const hasMp4 = Boolean(st().preview && st().preview.hasMp4)
    const on = L.online || null
    return [
      plazaTabs(ctx),
      h('p.pk-ops-sub', null, `${brand.tagline || '双引擎动效 · 全品类节拍卡点 · 开放 MOTION.md 蓝图模板社区'} · 原创作者 ${brand.author || 'Merziller'}`),
      ui.chips({
        value: L.cat || 'all',
        options: cats,
        onChange: (v) => {
          L.cat = v
          loadPlaza(ctx)
        },
      }),
      h(
        'div.pk-ops-toolbar',
        null,
        search,
        L.loading ? ui.spinner('读取中') : ui.hint(`${list.length} 个模板${L.total && L.total !== list.length ? ` / 共 ${L.total}` : ''} · 点封面播放样片`),
        ui.btn('刷新在线模板', () => syncOnline(ctx), {
          size: 'sm',
          icon: 'cloud',
          busyText: '同步中…',
          disabled: Boolean(L.syncing),
          title: '从作者的影核广场在线模板库下载新收录 / 更新的模板（只在你点这个按钮时联网；只下载经过校验的数据文件）',
        }),
      ),
      L.syncing
        ? h('div.pk-ops-syncbar', null, ui.meter(L.syncing.progress, { label: L.syncing.message || '正在刷新在线模板…', indeterminate: !L.syncing.progress }))
        : on && (on.lastSyncAt || on.lastError)
          ? ui.hint(
              on.lastError && (!on.lastSyncAt || String(on.lastAttemptAt) > String(on.lastSyncAt))
                ? `上次刷新（${U.fmtTime(on.lastAttemptAt)}）：${on.lastError}`
                : `在线模板 ${on.count || 0} 个 · 上次刷新 ${U.fmtTime(on.lastSyncAt)}${on.source ? ` · 来源 ${on.source}` : ''}`,
            )
          : null,
      L.err && !list.length
        ? ui.errorBox(L.err, () => loadPlaza(ctx))
        : !L.list
          ? ui.loading('正在打开影核广场…')
          : list.length
            ? ui.grid(list.map((t) => plazaCard(ctx, t)), { min: 260 })
            : ui.empty({ icon: 'hub', title: '没有找到匹配的模板', text: L.q ? `换个关键词试试，或清空搜索查看全部模板。` : '这个分类暂时还没有模板。', actions: [ui.btn('查看全部模板', () => ((L.cat = 'all'), (L.q = ''), loadPlaza(ctx)), { icon: 'grid' })] }),
      ui.note('想让更多人用上你的作品？把成片投稿到影核广场：作者审核通过后会收录进在线模板库，所有用户点「刷新在线模板」就能一键套用同款。投稿包会先经过隐私检查，并由你自己发给作者，插件不会自动上传。', {
        level: 'info',
        title: '投稿到影核广场',
        actions: [ui.btn('去投稿', () => plazaGo(ctx, 'submit'), { size: 'sm', icon: 'send', kind: 'primary' }), ui.btn('我的投稿', () => plazaGo(ctx, 'mine'), { size: 'sm', icon: 'box', kind: 'ghost' })],
      }),
      ui.section(
        {
          title: '把当前工程发布为模板（仅本机）',
          en: 'PUBLISH TO MY TEMPLATES',
          icon: 'upload',
          desc: PK.hasProject()
            ? '发布后会出现在「社区 / 我的发布」，只保存在你的电脑上，以后任何工程都能一键套用同款节奏与风格。只发布分镜结构与风格蓝图，不会带走你的私有素材文件。想分享给所有人，请用上面的「投稿到影核广场」。'
            : '先新建或打开一个视频工程，才能把它发布为模板。',
        },
        h(
          'div.pk-ops-pub',
          null,
          ui.field({ label: '模板名称', en: 'NAME', hint: defName ? `留空则使用「${defName}」` : '' }, ui.input({ key: 'plaza-pub-name', value: L.pubName || '', placeholder: defName ? `默认：${defName}` : '例如：秋日咖啡馆 · 温暖治愈宣传片', maxLength: 80, onInput: (v) => (L.pubName = v), disabled: !PK.hasProject() })),
          ui.field({ label: '所属分类', en: 'CATEGORY' }, ui.select({ value: L.pubCat, options: pubCats, onChange: (v) => (L.pubCat = v), disabled: !PK.hasProject() })),
        ),
        ui.field(
          { label: '一句话简介', en: 'DESCRIPTION', hint: '简述画风、节奏与适用题材，方便以后搜索' },
          ui.textarea({ key: 'plaza-pub-desc', value: L.pubDesc || '', rows: 2, maxRows: 8, maxLength: 400, placeholder: '例如：暖色调 · 慢推镜头 · 轻爵士卡点，适合咖啡 / 烘焙 / 门店新品宣传', onInput: (v) => (L.pubDesc = v), disabled: !PK.hasProject(), expand: { title: '模板简介' } }),
        ),
        ui.field({ label: '标签（可选）', en: 'TAGS', hint: '用逗号或空格分隔，最多 8 个；留空会按体裁与引擎自动生成' }, ui.input({ key: 'plaza-pub-tags', value: L.pubTags || '', placeholder: '温暖, 门店, 竖屏', maxLength: 160, onInput: (v) => (L.pubTags = v), disabled: !PK.hasProject() })),
        PK.hasProject() && !hasMp4 ? ui.note('当前工程还没有渲染成片，发布的模板暂时不带可播放样片；出片后重新发布即可自动附带约 15 秒样片。', { level: 'info' }) : null,
        ui.row([ui.btn('发布到影核广场', () => publishTemplate(ctx), { kind: 'primary', icon: 'upload', busyText: '发布中（截取样片）…', disabled: !PK.hasProject() })], { end: true }),
      ),
    ]
  }

  function plazaPlayer(ctx, t) {
    const L = ctx.local
    const prev = tplPreview(t)
    const cover = tplCover(t)
    const vertical = tplVertical(t)
    if (!prev) {
      dropVideo(ctx, 'plaza')
      return h(
        'div.pk-stack',
        null,
        cover ? h('div.pk-ops-player', { class: { 'is-vertical': vertical } }, h('img', { src: cover, alt: t.name || '', draggable: 'false' })) : null,
        ui.note('这个模板暂未附带可播放样片。发布模板时，若工程已渲染出 output/final.mp4，工作台会自动截取约 15 秒带声音的样片；也可以先「一键套用同款」后在自己的工程里渲染查看效果。', { level: 'info' }),
      )
    }
    const P = (L.player = L.player || { needsTap: false, error: '' })
    const v = keepVideo(ctx, 'plaza', prev, (el) => {
      el.controls = true
      el.preload = 'auto'
      el.setAttribute('controlslist', 'nodownload noremoteplayback')
      if (cover) el.poster = cover
      el.addEventListener('playing', () => {
        if (P.needsTap || P.error) {
          P.needsTap = false
          P.error = ''
          ctx.update()
        }
      })
      el.addEventListener('error', () => {
        P.error = '样片加载失败：请确认工作台后台服务仍在运行，然后点「重试」。'
        ctx.update()
      })
    })
    if (L.autoplay) {
      L.autoplay = false
      requestAnimationFrame(() => {
        try {
          v.muted = false
          v.volume = 1
          const pr = v.play()
          if (pr && typeof pr.catch === 'function')
            pr.catch((err) => {
              if (err && err.name === 'NotAllowedError') {
                P.needsTap = true
                ctx.update()
              }
            })
        } catch {}
      })
    }
    return h(
      'div.pk-ops-player',
      { class: { 'is-vertical': vertical } },
      v,
      P.needsTap && !P.error
        ? h(
            'div.pk-ops-ov.is-tap',
            null,
            ui.btn('点击播放（含声音）', () => {
              v.muted = false
              const pr = v.play()
              if (pr && typeof pr.then === 'function')
                pr.then(() => {
                  P.needsTap = false
                  ctx.update()
                }).catch(() => {})
            }, { kind: 'primary', size: 'lg', icon: 'play' }),
          )
        : null,
      P.error
        ? h(
            'div.pk-ops-ov',
            null,
            h('span', null, P.error),
            ui.btn('重试', () => {
              P.error = ''
              P.needsTap = false
              try {
                v.load()
                const pr = v.play()
                if (pr && typeof pr.catch === 'function') pr.catch(() => {})
              } catch {}
              ctx.update()
            }, { icon: 'retry' }),
          )
        : null,
    )
  }

  function plazaDetailView(ctx) {
    const L = ctx.local
    const fromList = (L.list || []).find((x) => x.id === L.detailId)
    const t = (L.detail && L.detail.template) || fromList
    if (!t) return L.detailErr ? [ui.errorBox(L.detailErr, () => openPlazaDetail(ctx, L.detailId))] : [ui.loading('正在打开模板…')]
    ctx.setTitle(`样片 · ${t.name || t.id}`, 'TEMPLATE PREVIEW · 影核广场')
    const md = L.detail ? String(L.detail.motionMd || '') : null
    const info = [
      ['体裁', t.genreLabel || t.genre || '—'],
      ['镜头', `${t.shotCount || 0} 镜${t.avgShotSec ? ` · 平均 ${t.avgShotSec}s` : ''}`],
      ['节拍', `${t.bpm || 110} BPM`],
      ['全片时长', `${t.durationSec || 60} 秒`],
      ['引擎 · 画幅', `${t.engine === 'html' ? 'HTML5' : 'Remotion'} · ${t.aspectRatio || '16:9'}${t.fps ? ` · ${t.fps} fps` : ''}`],
      ['配音节奏', PK.optionLabel('narrationModes', t.narrationMode, t.narrationMode || '—')],
      L.detail ? ['分镜数量', `${num(L.detail.sceneCount)} 个（套用时可选择连同分镜一起导入）`] : null,
      ['来源', t.source === 'custom' ? '社区 / 我的发布' : t.source === 'online' ? '在线模板库（作者审核收录）' : '官方精选'],
      t.author ? ['作者', t.author] : null,
      t.updatedAt ? ['更新时间', U.fmtTime(t.updatedAt)] : null,
    ].filter(Boolean)
    const sig = [].concat(t.transitionSignature || []).filter(Boolean)
    const vfx = [].concat(t.vfxSignature || []).filter(Boolean)
    return [
      ui.row([ui.btn('返回广场', () => plazaBack(ctx), { icon: 'chevL', kind: 'ghost' }), h('p.pk-ops-meta.pk-ops-grow', null, tplMetaLine(t).join(' · '))]),
      ui.split(
        [plazaPlayer(ctx, t), (t.tags || []).length ? h('div.pk-card-tags', null, (t.tags || []).map((x) => ui.tag(x))) : null],
        [
          ui.section({ title: t.name || t.id, en: 'TEMPLATE', icon: 'hub' }, t.description ? h('p.pk-ops-body', null, t.description) : null, ui.kv(info)),
          swatches(t.colorPalette) ? ui.section({ title: '配色', en: 'PALETTE' }, swatches(t.colorPalette)) : null,
          sig.length || vfx.length
            ? ui.section(
                { title: '转场与特效签名', en: 'SIGNATURE' },
                sig.length ? ui.row(sig.map((x) => ui.tag(transitionLabel(x), { active: true }))) : null,
                vfx.length ? ui.row(vfx.map((x) => ui.tag(String(x)))) : null,
              )
            : null,
        ],
        { ratio: 'minmax(0, 1.25fr) minmax(0, 1fr)' },
      ),
      ui.section(
        {
          title: 'MOTION.md 蓝图',
          en: 'BLUEPRINT',
          icon: 'code',
          desc: '套用后会写入你的工程根目录，任何 AI 智能体都能按它复刻同款节奏与画面。',
          actions: md ? [ui.btn('放大查看', () => openTextViewer(`MOTION.md · ${t.name}`, 'MOTION.md BLUEPRINT', md), { size: 'sm', icon: 'expand' }), ui.btn('复制', async () => PK.toast((await U.copyText(md)) ? '已复制 MOTION.md' : '复制失败', 'success'), { size: 'sm', icon: 'copy' })] : null,
        },
        md === null ? (L.detailErr ? ui.errorBox(L.detailErr, () => openPlazaDetail(ctx, t.id)) : ui.loading('正在读取蓝图…')) : md ? ui.code(md, { class: 'pk-ops-md' }) : ui.hint('这个模板没有附带 MOTION.md，套用时会按模板参数自动生成。'),
      ),
    ]
  }

  /* ---------------------------------------------------------------- 2b · 影核广场社区：投稿 / 我的投稿 / 在线模板 */
  const PSUB_KEY = 'pk-plaza-author-v1'
  const SHARE_FILES = [
    { name: 'template.json', label: '模板信息', desc: '标题、分类、简介、标签、作者昵称，以及配色、节奏、转场等风格参数', icon: 'list' },
    { name: 'MOTION.md', label: '动效蓝图', desc: '分镜表（每镜前 36 字文案）、转场与节奏，任何 AI 都能照着复刻', icon: 'code' },
    { name: 'script.json', label: '分镜脚本（已脱敏）', desc: '分镜的文案、画面描述与时间轴；素材只保留文件名，不含素材本身', icon: 'film' },
    { name: 'preview.mp4', label: '样片（≤ 15 秒）', desc: '从成片截取，最长边不超过 960 像素，已去掉视频里的元数据', icon: 'play' },
    { name: 'cover.jpg', label: '封面', desc: '成片画面截图（JPG），已去掉图片元数据', icon: 'image' },
    { name: 'submission.json', label: '投稿说明', desc: '投稿信息、授权声明、插件版本、创建时间，以及每个文件的 SHA-256 校验值', icon: 'check' },
  ]
  const SHARE_ICON = Object.fromEntries(SHARE_FILES.map((f) => [f.name, f.icon]))
  const NOT_SHARED = ['素材原文件（图片 / 视频 / 音乐 / 录音）', '配音与混音音频、数字人视频', 'API 密钥、模型与云端服务设置', '本机路径、电脑用户名与计算机名', '工程里的其他文件（代码、缓存、历史版本）']
  const CONSENT_LABEL = '我授权作者 Merziller 在影核广场展示、整理（可调整标题、分类与简介）和分发这份投稿；内容为本人原创或已获授权，不侵犯他人的版权、肖像权与隐私'
  const CHANNEL_NAMES = { github: 'GitHub', email: '邮件', other: '其他方式' }
  const FIELD_NAMES = {
    narration: '旁白',
    title: '标题',
    subtitle: '字幕',
    subtitles: '字幕',
    visualPrompt: '画面描述',
    visualBlueprint: '画面蓝图',
    motionNotes: '动效说明',
    directorNotes: '导演备注',
    contentOutline: '内容大纲',
    topic: '主题',
    goal: '目标',
    audience: '受众',
    displayTitle: '显示标题',
    description: '简介',
  }
  /** 'script.scenes[1].narration' → '第 2 镜 · 旁白' */
  function whereLabel(w) {
    const s = String(w || '').replace(/\s*\(字段名\)$/, '')
    const m = /scenes\[(\d+)\]\.?([A-Za-z]+)?/.exec(s)
    if (m) return `第 ${Number(m[1]) + 1} 镜${m[2] ? ` · ${FIELD_NAMES[m[2]] || m[2]}` : ''}`
    const k = /([A-Za-z]+)(?:\[\d+\])?$/.exec(s)
    return (k && FIELD_NAMES[k[1]]) || s.replace(/^script\.?/, '') || s
  }
  function rememberedAuthor() {
    try {
      const v = JSON.parse(localStorage.getItem(PSUB_KEY) || '{}') || {}
      return { author: U.str(v.author).slice(0, 32), contact: U.str(v.contact).slice(0, 80) }
    } catch {
      return { author: '', contact: '' }
    }
  }
  function rememberAuthor(S) {
    try {
      localStorage.setItem(PSUB_KEY, JSON.stringify({ author: S.author || '', contact: S.contact || '' }))
    } catch {}
  }
  async function copyOut(text, ok) {
    const done = await U.copyText(String(text || ''))
    PK.toast(done ? ok : '复制失败，请手动选择文字复制', done ? 'success' : 'warn')
  }
  function openGithub(url) {
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch {}
    PK.toast('已在新标签页打开 GitHub 投稿表单：登录后把投稿包拖进「上传投稿包」框，等出现链接后再提交。没打开的话，点「复制链接」粘贴到浏览器。', 'info', { timeout: 11000 })
  }
  function openMail(url) {
    try {
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {}
    PK.toast('已尝试打开你的邮件程序（标题和正文已填好），记得把投稿包作为附件加上再发送。没反应的话，点「复制邮箱」「复制正文」自己发一封。', 'info', { timeout: 11000 })
  }

  function plazaTabs(ctx) {
    const L = ctx.local
    const n = Array.isArray(L.mine) ? L.mine.length : 0
    return ui.tabs({
      value: L.view === 'detail' ? 'grid' : L.view,
      items: [
        { value: 'grid', label: '模板广场', icon: 'hub' },
        { value: 'submit', label: '投稿到影核广场', icon: 'send', hint: '把你的作品打包发给作者，审核通过后收录进在线模板库' },
        { value: 'mine', label: '我的投稿', icon: 'box', badge: n || null },
      ],
      onChange: (v) => plazaGo(ctx, v),
    })
  }
  function plazaGo(ctx, view) {
    const L = ctx.local
    if (L.view === 'detail') dropVideo(ctx, 'plaza')
    dropVideo(ctx, 'plaza-sub')
    if (view === 'grid' && L.view === 'detail') return plazaBack(ctx)
    L.view = view
    if (view === 'mine') {
      L.pkg = null
      loadMine(ctx, true)
    }
    if (view === 'submit') {
      ensureSub(ctx)
      if (!L.subResult && !L.subPrev && PK.hasProject()) previewSub(ctx)
    }
    ctx.render()
  }

  async function loadMine(ctx, force) {
    const L = ctx.local
    if (L.mineLoading && !force) return
    L.mineLoading = true
    try {
      const d = await PK.get('plaza/submissions')
      L.mine = Array.isArray(d.submissions) ? d.submissions : []
      L.mineRoot = U.str(d.root)
      if (d.online) L.online = d.online
      L.mineErr = null
    } catch (err) {
      L.mineErr = err
    } finally {
      L.mineLoading = false
      ctx.update()
    }
  }

  async function syncOnline(ctx) {
    const L = ctx.local
    if (L.syncing) return
    L.syncing = { progress: 0, message: '正在连接影核广场在线模板库…' }
    ctx.update()
    try {
      const start = await PK.post('plaza/remote-sync', {})
      const res =
        start && start.jobId
          ? await PK.job(start.jobId, {
              onProgress: (job) => {
                L.syncing = { progress: num(job.progress), message: U.str(job.message) }
                liveUpdate(ctx)
              },
            })
          : start
      if (res && res.ok) PK.toast(res.message || '在线模板已刷新', res.failed || res.rejected ? 'warn' : 'success', { timeout: 9000 })
      else if (res && res.notPublished) PK.toast(res.message, 'info', { timeout: 10000 })
      else PK.toast((res && res.message) || '在线模板库暂时连不上，请稍后再试', 'warn', { title: '在线模板库暂时连不上', timeout: 12000 })
      PK.store.invalidate()
      await loadPlaza(ctx)
    } finally {
      L.syncing = null
      loadMine(ctx, true)
      ctx.update()
    }
  }

  function ensureSub(ctx) {
    const L = ctx.local
    const dir = dirKey()
    if (L.sub && L.sub.dir === dir) return L.sub
    const script = (L.store && L.store.activeProject && L.store.activeProject.script) || {}
    const ids = (L.cats && L.cats.length ? L.cats : PLAZA_FALLBACK_CATS).map((c) => c.id).filter((id) => id !== 'all')
    const mem = rememberedAuthor()
    L.sub = {
      dir,
      title: U.str(script.displayTitle || script.title || (st().project && st().project.title) || '').slice(0, 60),
      category: ids.includes(script.genre) ? script.genre : 'custom',
      description: '',
      tags: '',
      author: mem.author,
      contact: mem.contact,
      consent: false,
      allowNames: false,
      previewStartSec: '',
    }
    L.subPrev = null
    L.subPrevErr = null
    L.subResult = null
    return L.sub
  }
  const subPayload = (S) => ({
    title: S.title,
    category: S.category,
    description: S.description,
    tags: S.tags,
    author: S.author,
    contact: S.contact,
    consent: Boolean(S.consent),
    allowNames: Boolean(S.allowNames),
    previewStartSec: S.previewStartSec === '' || S.previewStartSec === null ? undefined : Number(S.previewStartSec),
  })
  function subDirty(ctx) {
    const L = ctx.local
    if (L.subSoon) L.subSoon()
    ctx.update()
  }
  async function previewSub(ctx) {
    const L = ctx.local
    if (!PK.hasProject() || !L.sub) return
    const seq = (L.subSeq = (L.subSeq || 0) + 1)
    L.subPrevLoading = true
    ctx.update()
    try {
      const d = await PK.postP('plaza/submit', { action: 'preview', ...subPayload(L.sub) })
      if (seq === L.subSeq) {
        L.subPrev = d
        L.subPrevErr = null
      }
    } catch (err) {
      if (seq === L.subSeq) L.subPrevErr = err
    } finally {
      if (seq === L.subSeq) {
        L.subPrevLoading = false
        ctx.update()
      }
    }
  }
  /** first thing still missing before the package can be built ('' = ready) */
  function subMissing(ctx) {
    const L = ctx.local
    const S = L.sub || {}
    if (!PK.hasProject()) return '先打开一个已出片的工程'
    if (!(st().preview && st().preview.hasMp4)) return '先渲染成片（投稿包需要 ≤ 15 秒样片）'
    if (!U.str(S.title).trim()) return '还差：作品标题'
    if (!U.str(S.author).trim()) return '还差：作者昵称'
    const p = L.subPrev
    if (p && p.privacy && p.privacy.needsNameConfirm && !S.allowNames) return '还差：确认内容里的电脑用户名可以公开（或先改掉）'
    if (p && (p.blocking || []).length) return '还有内容无法自动清理，请看右侧提示'
    if (!S.consent) return '还差：勾选授权声明'
    return ''
  }
  async function buildSub(ctx) {
    const L = ctx.local
    const S = ensureSub(ctx)
    const missing = subMissing(ctx)
    if (missing) throw new PK.Error(missing)
    rememberAuthor(S)
    L.subJob = { progress: 2, message: '正在准备…' }
    ctx.render()
    try {
      const start = await PK.postP('plaza/submit', { action: 'build', ...subPayload(S) }, { timeout: 900000 })
      const res =
        start && start.jobId
          ? await PK.job(start.jobId, {
              onProgress: (job) => {
                L.subJob = { progress: num(job.progress), message: U.str(job.message) }
                liveUpdate(ctx)
              },
            })
          : start
      L.subResult = res
      dropVideo(ctx, 'plaza-sub')
      PK.toast('投稿包已生成！选择一种方式发给作者吧。', 'success', { timeout: 7000 })
      loadMine(ctx, true)
    } catch (err) {
      if (err && err.code === 'need-name-confirm') previewSub(ctx)
      throw err
    } finally {
      L.subJob = null
      ctx.render()
    }
  }
  function resetSub(ctx) {
    const L = ctx.local
    dropVideo(ctx, 'plaza-sub')
    const keep = L.sub ? { author: L.sub.author, contact: L.sub.contact } : {}
    L.sub = null
    ensureSub(ctx)
    Object.assign(L.sub, keep)
    previewSub(ctx)
    ctx.render()
  }

  async function openPkg(ctx, id) {
    const L = ctx.local
    try {
      const d = await PK.get('plaza/submissions', { id })
      dropVideo(ctx, 'plaza-sub')
      L.view = 'mine'
      L.pkg = d
      ctx.render()
    } catch (err) {
      PK.reportError(err)
    }
  }
  async function markPkg(ctx, id, submitted, channel) {
    const L = ctx.local
    const r = await PK.post('plaza/submit', { action: 'mark', id, submitted, channel: channel || '' })
    const patch = (s) => (s && s.id === id ? Object.assign(s, { submitted: r.submitted, submittedAt: r.submittedAt, channel: r.channel }) : s)
    if (L.subResult && L.subResult.submission) patch(L.subResult.submission)
    if (L.pkg && L.pkg.submission) patch(L.pkg.submission)
    ;(L.mine || []).forEach(patch)
    PK.toast(r.submitted ? '已标记为「已投稿」' : '已取消「已投稿」标记', 'success')
    ctx.render()
  }
  async function deletePkg(ctx, s) {
    const L = ctx.local
    const ok = await PK.confirm({
      title: '删除这个投稿包？',
      text: `会删除本机上的投稿包「${s.title}」（${s.zipName}，${U.fmtBytes(s.zipBytes)}）。已经发给作者的投稿不受影响；删除后不能恢复，需要时可以重新生成。`,
      ok: '删除',
      danger: true,
    })
    if (!ok) return
    await PK.post('plaza/submissions/delete', { id: s.id })
    if (L.pkg && L.pkg.submission && L.pkg.submission.id === s.id) {
      dropVideo(ctx, 'plaza-sub')
      L.pkg = null
    }
    if (L.subResult && L.subResult.submission && L.subResult.submission.id === s.id) L.subResult = null
    PK.toast('投稿包已删除', 'success')
    await loadMine(ctx, true)
  }
  async function revealPkg(s) {
    const r = await PK.post('plaza/reveal', { id: s.id })
    if (r && r.opened) PK.toast('已在文件管理器里选中投稿包，可以直接拖到网页或邮件里。', 'success', { timeout: 7000 })
    else {
      const ok = await U.copyText(U.str(r && r.path))
      PK.toast(`当前系统不能自动打开文件夹。投稿包在：${U.str(r && r.path)}${ok ? '（路径已复制）' : ''}`, 'info', { timeout: 12000 })
    }
  }

  function shareList(files) {
    return h(
      'div.pk-ops-share',
      null,
      files.map((f) =>
        h(
          'div.pk-ops-file',
          { key: `pf-${f.name}` },
          h('i', null, PK.icon(SHARE_ICON[f.name] || 'box', 15)),
          h('b', null, f.name),
          h('em', null, num(f.bytes || f.size) ? U.fmtBytes(f.bytes || f.size) : f.name === 'preview.mp4' ? '≤ 15 秒' : ''),
          h('p', null, `${f.label || ''}${f.desc ? ` · ${f.desc}` : ''}`),
        ),
      ),
    )
  }
  function textButtons(texts) {
    const t = texts || {}
    return ['template.json', 'MOTION.md', 'script.json', 'submission.json']
      .filter((n) => t[n])
      .map((n) => ui.btn(n, () => openTextViewer(`将分享的 ${n}`, 'WHAT WILL BE SHARED', t[n], { hint: '这就是投稿包里这个文件的内容（已经过隐私清理）。' }), { size: 'sm', kind: 'ghost', icon: 'eye', title: `查看 ${n} 的完整内容` }))
  }

  function plazaSubmitView(ctx) {
    const L = ctx.local
    const S = ensureSub(ctx)
    if (L.subResult) return plazaPackageView(ctx, L.subResult, { fresh: true })
    if (!PK.hasProject()) {
      return [
        plazaTabs(ctx),
        ui.empty({
          icon: 'film',
          title: '先打开一个已经出片的工程',
          text: '投稿包会从工程的成片里截取 ≤ 15 秒样片，并附上分镜结构与风格蓝图（不含素材原文件）。',
          actions: [ui.btn('打开 / 新建工程', () => PK.open('projects'), { icon: 'folder', kind: 'primary' })],
        }),
      ]
    }
    const hasFilm = Boolean(st().preview && st().preview.hasMp4)
    const p = L.subPrev
    const cats = (L.cats && L.cats.length ? L.cats : PLAZA_FALLBACK_CATS).filter((c) => c.id !== 'all').map((c) => ({ value: c.id, label: c.id === 'custom' ? '其他 / 不确定' : c.label }))
    const film = p && p.film
    const plan = p && p.previewPlan
    const needNames = Boolean((p && p.privacy && p.privacy.needsNameConfirm) || S.allowNames)
    const form = ui.section(
      { title: '投稿信息', en: 'SUBMISSION', icon: 'edit', desc: '作者审核通过后，这些信息会显示在影核广场的模板卡片上（作者可能微调标题、分类与简介）。' },
      !hasFilm ? ui.note('当前工程还没有成片。投稿包需要从成片截取一段 ≤ 15 秒的样片：请先在「分步精修 → 交付」渲染成片，再回来投稿。', { level: 'warn', title: '还不能投稿' }) : null,
      ui.grid(
        [
          ui.field({ label: '作品标题', en: 'TITLE', required: true }, ui.input({ key: 'psub-title', value: S.title, maxLength: 60, placeholder: '例如：秋日咖啡馆 · 温暖治愈宣传片', onInput: (v) => ((S.title = v), subDirty(ctx)) })),
          ui.field({ label: '分类', en: 'CATEGORY', required: true }, ui.select({ value: S.category, options: cats, onChange: (v) => ((S.category = v), subDirty(ctx)) })),
        ],
        { min: 220, fit: true },
      ),
      ui.field(
        { label: '一句话简介', en: 'DESCRIPTION', hint: '画风、节奏与适合的题材，方便大家搜索（最多 300 字）' },
        ui.textarea({ key: 'psub-desc', value: S.description, rows: 2, maxRows: 6, maxLength: 300, counter: true, placeholder: '例如：暖色调 · 慢推镜头 · 轻爵士卡点，适合咖啡 / 烘焙 / 门店新品宣传', onInput: (v) => ((S.description = v), subDirty(ctx)), expand: { title: '作品简介' } }),
      ),
      ui.field({ label: '标签（可选）', en: 'TAGS', hint: '用逗号或空格分隔，最多 8 个' }, ui.input({ key: 'psub-tags', value: S.tags, maxLength: 160, placeholder: '温暖, 门店, 竖屏', onInput: (v) => ((S.tags = v), subDirty(ctx)) })),
      ui.grid(
        [
          ui.field({ label: '作者昵称', en: 'AUTHOR', required: true, hint: '收录后显示在模板卡片上' }, ui.input({ key: 'psub-author', value: S.author, maxLength: 32, placeholder: '你的昵称', onInput: (v) => ((S.author = v), subDirty(ctx)) })),
          ui.field(
            { label: '联系方式（可选）', en: 'CONTACT', hint: '方便作者联系你。注意：GitHub 上的投稿包和 Issue 是公开的，不想公开就留空或改用邮件投稿' },
            ui.input({ key: 'psub-contact', value: S.contact, maxLength: 80, placeholder: '邮箱 / 微信 / QQ', onInput: (v) => ((S.contact = v), subDirty(ctx)) }),
          ),
        ],
        { min: 220, fit: true },
      ),
      ui.field(
        { label: '样片起点（可选）', en: 'SAMPLE START', hint: film && plan ? `留空 = 自动从第 ${plan.startSec} 秒开始（避开片头）；成片共 ${Math.round(film.durationSec)} 秒，样片最长 15 秒` : '留空 = 自动避开片头；样片最长 15 秒' },
        ui.input({ key: 'psub-start', type: 'number', min: 0, step: 0.5, value: S.previewStartSec, placeholder: '自动', onInput: (v) => ((S.previewStartSec = v), subDirty(ctx)) }),
      ),
      ui.check({ value: S.consent, onChange: (v) => ((S.consent = v), ctx.render()), label: CONSENT_LABEL, hint: '必选' }),
      needNames ? ui.check({ value: S.allowNames, onChange: (v) => ((S.allowNames = v), previewSub(ctx), ctx.render()), label: '右侧列出的词是正常内容（例如品牌名、角色名），可以公开' }) : null,
    )
    const pr = (p && p.privacy) || null
    const files = p && Array.isArray(p.files) ? p.files : SHARE_FILES
    const share = ui.section(
      {
        title: '将分享的内容',
        en: 'WHAT WILL BE SHARED',
        icon: 'eye',
        desc: '投稿包里只有下面这些文件；生成后你可以逐个查看，再决定要不要发出去。',
        actions: [L.subPrevLoading ? ui.spinner('检查中') : null],
      },
      L.subJob ? ui.meter(L.subJob.progress, { label: L.subJob.message || '正在生成投稿包…', indeterminate: !L.subJob.progress }) : null,
      shareList(files),
      L.subPrevErr ? ui.note(String(L.subPrevErr.message || L.subPrevErr), { level: 'error', title: '检查失败', actions: [ui.btn('重试', () => previewSub(ctx), { size: 'sm', icon: 'retry' })] }) : null,
      pr ? ui.note(pr.summary || '没有发现需要清理的隐私信息', { level: 'ok', title: '隐私检查' }) : !L.subPrevErr ? ui.hint('正在检查隐私信息…') : null,
      pr && pr.names && pr.names.length
        ? ui.note(
            [
              h('div', null, '下面这些位置出现了你的电脑用户名 / 计算机名（已打码）。如果是正常内容（例如品牌名或角色名），勾选左边的「可以公开」；否则请先在工程里改掉：'),
              h('ul.pk-ops-nots', null, pr.names.slice(0, 6).map((n, i) => h('li', { key: `pn-${i}` }, `${whereLabel(n.where)} · ${n.name}`))),
            ],
            { level: 'warn', title: '需要你确认' },
          )
        : null,
      ...((p && p.blocking) || []).map((b) => ui.note(b, { level: 'warn' })),
      p && p.texts ? ui.row(textButtons(p.texts)) : null,
      h('div.pk-ops-sub', null, '不会分享：'),
      h('ul.pk-ops-nots', null, ((p && p.notShared) || NOT_SHARED).map((x, i) => h('li', { key: `ns-${i}` }, x))),
    )
    return [plazaTabs(ctx), ui.split([form], [share], { ratio: 'minmax(0, 1.1fr) minmax(0, 1fr)' })]
  }

  function plazaPackageView(ctx, data, { fresh }) {
    const L = ctx.local
    const s = (data && data.submission) || {}
    const ch = (data && data.channels) || {}
    const src = U.str(s.previewUrl)
    const video = src
      ? keepVideo(ctx, 'plaza-sub', src, (el) => {
          el.controls = true
          el.setAttribute('controlslist', 'nodownload noremoteplayback')
          if (s.coverUrl) el.poster = s.coverUrl
        })
      : null
    const files = Array.isArray(s.files) ? s.files : []
    const status = s.submitted ? `已投稿${s.channel ? `（${CHANNEL_NAMES[s.channel] || s.channel}）` : ''}${s.submittedAt ? ` · ${U.fmtTime(s.submittedAt)}` : ''}` : '还没标记为已投稿'
    const info = ui.kv([
      ['投稿包', s.zipName],
      ['大小', U.fmtBytes(s.zipBytes)],
      ['SHA-256', h('span.pk-ops-mono', { title: s.zipSha256 }, `${U.str(s.zipSha256).slice(0, 16)}…`)],
      ['分类', s.categoryLabel],
      ['作者昵称', s.author],
      ['联系方式', s.contact || '（未填写）'],
      ['创建时间', U.fmtTime(s.createdAt)],
      ['状态', status],
    ])
    const channels = h(
      'div.pk-ops-channels',
      null,
      h(
        'div.pk-ops-channel',
        null,
        h('b', null, '① 去 GitHub 投稿（推荐）'),
        h('p', null, '打开已填好的投稿表单（需要登录 GitHub）。把投稿包拖进「上传投稿包」框，出现链接后点提交。GitHub 上的内容是公开的。'),
        ui.row([
          ui.btn('去 GitHub 投稿', () => openGithub(ch.githubUrl), { kind: 'primary', icon: 'external', disabled: !ch.githubUrl }),
          ui.btn('复制链接', () => copyOut(ch.githubUrl, '已复制投稿表单链接'), { size: 'sm', kind: 'ghost', icon: 'copy' }),
        ]),
      ),
      h(
        'div.pk-ops-channel',
        null,
        h('b', null, '② 邮件投稿'),
        h('p', null, `打开你的邮件程序并填好标题和正文（发给 ${ch.email || '作者'}），请手动把投稿包作为附件加上再发送。不会公开。`),
        ui.row([
          ui.btn('邮件投稿', () => openMail(ch.mailtoUrl), { icon: 'send', disabled: !ch.mailtoUrl }),
          ui.btn('复制邮箱', () => copyOut(ch.email, '已复制作者邮箱'), { size: 'sm', kind: 'ghost', icon: 'copy' }),
          ui.btn('复制正文', () => copyOut(`${ch.mailSubject || ''}\n\n${String(ch.mailBody || '').replace(/\r\n/g, '\n')}`, '已复制邮件标题和正文'), { size: 'sm', kind: 'ghost', icon: 'copy' }),
        ]),
      ),
      h(
        'div.pk-ops-channel',
        null,
        h('b', null, '③ 找到投稿包文件'),
        h('p', null, '在文件管理器里选中这个 zip，方便拖到网页或邮件里：'),
        h('p.pk-ops-pkgpath', { title: s.zipPath }, U.str(s.zipPath)),
        ui.row([
          ui.btn('打开投稿包所在文件夹', () => revealPkg(s), { icon: 'folder' }),
          ui.btn('复制路径', () => copyOut(s.zipPath, '已复制投稿包路径'), { size: 'sm', kind: 'ghost', icon: 'copy' }),
        ]),
      ),
    )
    return [
      plazaTabs(ctx),
      fresh
        ? ui.note(`投稿包已生成：${s.zipName}（${U.fmtBytes(s.zipBytes)}）。下面三种方式任选其一发给作者，都由你自己操作，插件不会自动上传任何东西。作者审核通过后会收录进在线模板库。`, { level: 'ok', title: '投稿包已准备好' })
        : ui.row([
            ui.btn('返回我的投稿', () => {
              dropVideo(ctx, 'plaza-sub')
              L.pkg = null
              ctx.render()
            }, { icon: 'chevL', kind: 'ghost' }),
            h('p.pk-ops-meta.pk-ops-grow', null, s.title || ''),
          ]),
      ui.split(
        [video ? h('div.pk-ops-player', null, video) : ui.note('这个投稿包没有样片文件。', { level: 'warn' }), info],
        [ui.section({ title: '发给作者', en: 'SEND TO THE AUTHOR', icon: 'send', desc: '投稿由你自己发出：GitHub 表单或邮件，二选一即可。发完后点下方「标记为已投稿」方便记录。' }, channels)],
        { ratio: 'minmax(0, 1fr) minmax(0, 1.25fr)' },
      ),
      ui.section(
        { title: '投稿包里的文件', en: 'PACKAGE CONTENTS', icon: 'box', count: files.length, actions: textButtons(data && data.texts) },
        ui.table({
          columns: [
            { key: 'name', label: '文件', render: (f) => h('span.pk-ops-mono', null, f.name) },
            { key: 'label', label: '内容' },
            { key: 'size', label: '大小', align: 'right', render: (f) => U.fmtBytes(f.size) },
            { key: 'sha256', label: 'SHA-256', render: (f) => (f.sha256 ? h('span.pk-ops-mono', { title: f.sha256 }, `${f.sha256.slice(0, 12)}…`) : '（本文件记录其他文件的校验值）') },
          ],
          rows: files,
        }),
      ),
    ]
  }

  function plazaMineView(ctx) {
    const L = ctx.local
    if (L.pkg) return plazaPackageView(ctx, L.pkg, { fresh: false })
    const list = L.mine
    return [
      plazaTabs(ctx),
      L.mineErr
        ? ui.errorBox(L.mineErr, () => loadMine(ctx, true))
        : !list
          ? ui.loading('正在读取我的投稿…')
          : list.length
            ? ui.section(
                { title: '我的投稿包', en: 'MY SUBMISSIONS', icon: 'box', count: list.length, desc: '投稿包只保存在你的电脑上。发给作者后，可以手动标记「已投稿」方便记录。' },
                L.mineRoot ? h('p.pk-ops-pkgpath', { title: L.mineRoot }, `保存位置：${L.mineRoot}`) : null,
                ui.list(
                  list.map((s) =>
                    ui.item({
                      key: `psub-${s.id}`,
                      thumb: s.coverUrl ? h('img.pk-ops-subthumb', { src: s.coverUrl, alt: '', loading: 'lazy', draggable: 'false' }) : null,
                      icon: s.coverUrl ? null : 'box',
                      title: s.title,
                      sub: `${s.categoryLabel || s.category} · ${U.fmtBytes(s.zipBytes)} · ${U.fmtTime(s.createdAt)}`,
                      meta: ui.pill(s.submitted ? `已投稿${s.channel ? ` · ${CHANNEL_NAMES[s.channel] || s.channel}` : ''}` : '未投稿', s.submitted ? 'ok' : 'mute', { dot: true }),
                      right: [
                        ui.btn('再次打开', () => openPkg(ctx, s.id), { size: 'sm', icon: 'eye', title: '查看投稿包内容，再次打开 GitHub / 邮件投稿' }),
                        ui.btn(s.submitted ? '取消已投稿' : '标记已投稿', () => markPkg(ctx, s.id, !s.submitted), { size: 'sm', kind: 'ghost', icon: 'check' }),
                        ui.btn('删除', () => deletePkg(ctx, s), { size: 'sm', kind: 'ghost', icon: 'trash' }),
                      ],
                      onClick: () => openPkg(ctx, s.id),
                    }),
                  ),
                ),
              )
            : ui.empty({
                icon: 'box',
                title: '还没有投稿包',
                text: '把满意的作品投稿到影核广场：生成投稿包后，用 GitHub 表单或邮件发给作者，审核通过就会收录进在线模板库。',
                actions: [ui.btn('去投稿', () => plazaGo(ctx, 'submit'), { icon: 'send', kind: 'primary' })],
              }),
    ]
  }

  PK.panel('plaza', {
    title: '影核广场',
    en: 'CINEPULSE HUB · MOTION.md 模板社区',
    idx: '03',
    icon: 'hub',
    kind: 'modal',
    size: 'xl',
    group: 'main',
    order: 20,
    desc: '模板样片墙：试看、一键套用同款节奏、投稿我的作品、刷新在线模板',
    aliases: { hub: {}, cinepulse: {}, templates: {}, template: {}, plazaPlayer: {}, plazaSubmit: { view: 'submit' }, plazaMine: { view: 'mine' } },
    watch: (s) => [s && s.project && s.project.dir, s && s.preview && s.preview.hasMp4],
    onWatch(ctx) {
      const L = ctx.local
      PK.store
        .load()
        .then((d) => {
          L.store = d
          // the project or its film changed: what will be shared changes too
          if (L.view === 'submit' && !L.subResult) {
            ensureSub(ctx)
            previewSub(ctx)
          }
          ctx.update()
        })
        .catch(() => {})
      ctx.update()
    },
    mount(ctx) {
      const L = ctx.local
      L.cat = ctx.args.category || 'all'
      L.q = ctx.args.q || ''
      L.view = 'grid'
      L.searchSoon = U.debounce(() => loadPlaza(ctx), 320)
      L.subSoon = U.debounce(() => previewSub(ctx), 1200)
      ctx.onCleanup(() => {
        L.searchSoon.cancel()
        L.subSoon.cancel()
      })
      armRenderGuard(ctx)
      PK.store
        .load()
        .then((d) => {
          L.store = d
          if (!L.list && d) {
            if (d.plazaBrand) L.brand = d.plazaBrand
            if (Array.isArray(d.plazaCategories) && d.plazaCategories.length) L.cats = d.plazaCategories
          }
          if (L.view === 'submit' && L.sub && !L.sub.title) {
            L.sub = null
            ensureSub(ctx)
          }
          ctx.update()
        })
        .catch(() => {})
      loadPlaza(ctx)
      loadMine(ctx)
      if (ctx.args.id) openPlazaDetail(ctx, String(ctx.args.id))
      else if (ctx.args.view === 'submit' || ctx.args.view === 'mine') plazaGo(ctx, ctx.args.view)
    },
    onArgs(ctx, a) {
      if (a.id) openPlazaDetail(ctx, String(a.id))
      else if (a.view === 'submit' || a.view === 'mine' || a.view === 'grid') plazaGo(ctx, a.view)
      else if (a.category) {
        ctx.local.cat = a.category
        if (ctx.local.view !== 'grid') plazaBack(ctx)
        loadPlaza(ctx)
      } else ctx.render()
    },
    beforeClose(ctx, reason) {
      // Esc in the sample player only returns to the wall (classic behaviour); the × always closes the hub
      if (reason === 'esc' && ctx.local.view === 'detail') {
        plazaBack(ctx)
        return false
      }
      if (reason === 'esc' && ctx.local.view === 'mine' && ctx.local.pkg) {
        dropVideo(ctx, 'plaza-sub')
        ctx.local.pkg = null
        ctx.render()
        return false
      }
      return true
    },
    unmount(ctx) {
      releaseAllMedia(ctx)
    },
    render(ctx) {
      const L = ctx.local
      const s = st()
      if (L.view === 'detail') {
        const t = (L.detail && L.detail.template) || (L.list || []).find((x) => x.id === L.detailId)
        ctx.foot([
          ui.btn('返回广场', () => plazaBack(ctx), { icon: 'chevL', kind: 'ghost' }),
          ui.hint(PK.hasProject() ? `套用到：${(s.project && s.project.title) || '当前工程'}` : '先新建或打开工程才能套用'),
          ui.spacer(),
          t ? ui.btn('连同分镜一起套用', () => applyTemplate(ctx, t, true), { icon: 'layers', busyText: '套用中…', disabled: !PK.hasProject(), title: '用模板的分镜替换当前分镜（会覆盖）' }) : null,
          t ? ui.btn('一键套用同款基因', () => applyTemplate(ctx, t, false), { kind: 'primary', icon: 'wand', busyText: '套用中…', disabled: !PK.hasProject() }) : null,
        ])
        return plazaDetailView(ctx)
      }
      dropVideo(ctx, 'plaza')
      if (L.view === 'submit') {
        ctx.setTitle('投稿到影核广场', 'SUBMIT TO CINEPULSE HUB · 作者审核后收录')
        ensureSub(ctx)
        if (L.subResult) {
          const sub = L.subResult.submission || {}
          ctx.foot([
            ui.hint(sub.submitted ? '已标记为已投稿，等作者审核收录即可' : '发出去之后，记得点「标记为已投稿」'),
            ui.spacer(),
            ui.btn(sub.submitted ? '取消「已投稿」' : '标记为已投稿', () => markPkg(ctx, sub.id, !sub.submitted), { icon: 'check', kind: sub.submitted ? 'ghost' : 'secondary' }),
            ui.btn('再投一个', () => resetSub(ctx), { icon: 'plus', kind: 'ghost' }),
          ])
        } else {
          const missing = subMissing(ctx)
          ctx.foot([
            ui.hint(missing || '准备好了：生成后可以逐个查看投稿包里的文件，再决定怎么发给作者'),
            ui.spacer(),
            ui.btn('预览将分享的内容', () => previewSub(ctx), { icon: 'eye', kind: 'ghost', busyText: '检查中…', disabled: !PK.hasProject() || Boolean(L.subJob) }),
            ui.btn('生成投稿包', () => buildSub(ctx), { kind: 'primary', icon: 'box', busyText: '生成中…', disabled: Boolean(missing) || Boolean(L.subJob) }),
          ])
        }
        return plazaSubmitView(ctx)
      }
      if (L.view === 'mine') {
        if (L.pkg) {
          const sub = L.pkg.submission || {}
          ctx.setTitle(`投稿包 · ${sub.title || ''}`, 'MY SUBMISSION · 影核广场')
          ctx.foot([
            ui.btn('返回我的投稿', () => {
              dropVideo(ctx, 'plaza-sub')
              L.pkg = null
              ctx.render()
            }, { icon: 'chevL', kind: 'ghost' }),
            ui.spacer(),
            ui.btn('删除', () => deletePkg(ctx, sub), { icon: 'trash', kind: 'ghost' }),
            ui.btn(sub.submitted ? '取消「已投稿」' : '标记为已投稿', () => markPkg(ctx, sub.id, !sub.submitted), { icon: 'check', kind: sub.submitted ? 'ghost' : 'primary' }),
          ])
        } else {
          ctx.setTitle('我的投稿', 'MY SUBMISSIONS · 影核广场')
          ctx.foot([
            ui.hint('投稿包只保存在你的电脑上，插件不会自动上传'),
            ui.spacer(),
            ui.btn('刷新', () => loadMine(ctx, true), { icon: 'refresh', kind: 'ghost' }),
            ui.btn('去投稿', () => plazaGo(ctx, 'submit'), { icon: 'send' }),
          ])
        }
        return plazaMineView(ctx)
      }
      ctx.setTitle('影核广场', 'CINEPULSE HUB · MOTION.md 模板社区')
      ctx.foot([
        ui.hint(PK.hasProject() ? `套用目标：${(s.project && s.project.title) || '当前工程'}` : '未打开工程：可以浏览和试看，套用前请先新建或打开工程'),
        ui.spacer(),
        ui.btn('刷新', () => loadPlaza(ctx), { icon: 'refresh', kind: 'ghost' }),
      ])
      return plazaGrid(ctx)
    },
  })

  /* ================================================================ 3 · 参考复刻 REFERENCE REMAKE */
  const REF = { job: null, lastError: '', listeners: new Set(), lastSource: Object.create(null) }
  /**
   * Relative path of the project's analysed reference video. The host's fallback (`activeProject.referenceVideoRel`, also
   * used by GET reference/video) reads `referenceStyle.sourceRel` while the analyzer writes `sourceRelPath`, so after
   * 换参考片 it can name an OLDER upload (the first video in reference/ alphabetically). Prefer sourceRelPath and remember
   * it per project, so 清除 → 直接重新拆解 / 同步对比 keep using the latest analysed clip.
   */
  function refSource(ap, rs) {
    const dir = dirKey()
    const own = (rs && (rs.sourceRelPath || rs.sourceRel)) || ''
    if (own) REF.lastSource[dir] = String(own)
    return own || REF.lastSource[dir] || (ap && ap.referenceVideoRel) || ''
  }
  const refEmit = () => {
    for (const fn of [...REF.listeners]) {
      try {
        fn()
      } catch {}
    }
  }
  /** runs a reference analysis job (upload or re-analyse) to the end even if the panel is closed meanwhile */
  async function runReferenceJob(label, starter) {
    if (REF.job) throw new PK.Error('上一段参考视频还在拆解中，请等它完成后再试')
    const dir = PK.needProject()
    REF.lastError = ''
    REF.job = { label, pct: 2, message: label, dir, startedAt: Date.now() }
    refEmit()
    try {
      const init = await starter(dir)
      let fin = init
      if (init && init.jobId) {
        REF.job.pct = Math.max(REF.job.pct, 6)
        REF.job.message = (init.job && init.job.message) || '正在拆解参考视频分镜节奏、节拍与视觉基因…'
        refEmit()
        fin = await PK.job(init.jobId, {
          interval: 800,
          onProgress: (j) => {
            if (!REF.job) return
            if (Number.isFinite(Number(j.progress))) REF.job.pct = U.clamp(Number(j.progress), REF.job.pct, 100)
            if (j.message) REF.job.message = String(j.message)
            refEmit()
          },
        })
      }
      if (!fin || fin.ok === false || !fin.referenceStyle) throw new PK.Error(`参考视频拆解异常：${(fin && fin.error) || '未返回风格基因'}`)
      const rs = fin.referenceStyle
      if (PK.dir() === dir) {
        try {
          await PK.action('refresh', { syncForm: true })
        } catch {}
      }
      PK.store.invalidate()
      PK.toast(`🎯 参考视频拆解完成！实测 ${rs.shotCount || 0} 镜 · ${rs.bpm || '?'} BPM · 已生成同款复刻基因与 MOTION.md，现在直接写你的新主题即可一键复刻同款！`, 'success', {
        action: { label: '写新主题', onClick: () => PK.editTopic() },
        timeout: 10000,
      })
      return rs
    } catch (err) {
      REF.lastError = String((err && err.message) || err || '参考视频拆解失败')
      throw err
    } finally {
      REF.job = null
      refEmit()
    }
  }
  const REF_PREFS = { extractAudio: false, useVision: true }
  const VIDEO_ACCEPT = 'video/*,.mp4,.mov,.webm,.mkv,.avi,.m4v'

  async function uploadReference(file) {
    if (!file) return
    if (!/^video\//.test(String(file.type || '')) && !/\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(String(file.name || ''))) throw new PK.Error('请选择视频文件（mp4 / mov / webm / mkv）')
    if (file.size > 600 * 1048576) {
      const ok = await PK.confirm({ title: '参考视频比较大', text: `「${file.name}」有 ${U.fmtBytes(file.size)}，上传和拆解会比较慢。建议先剪成 2 分钟以内的片段再上传。仍然继续吗？`, ok: '继续上传' })
      if (!ok) return
    }
    const vision = REF_PREFS.useVision && llmReady()
    return runReferenceJob(`正在上传并拆解参考视频「${file.name}」…`, (dir) => {
      const query = { projectDir: dir, fileName: file.name, extractAudioAsBgm: REF_PREFS.extractAudio ? '1' : '0', async: '1' }
      if (!vision) query.useVision = '0'
      return PK.upload('reference/upload', file, { query })
    })
  }
  async function reanalyzeReference(videoPath) {
    if (!videoPath) throw new PK.Error('没有找到参考视频文件，请重新上传')
    const vision = REF_PREFS.useVision && llmReady()
    const ok = await PK.confirm({
      title: '重新拆解参考视频？',
      text: `会重新测量镜头切点、BPM 与画面风格，并覆盖当前的复刻基因${vision ? '（会调用多模态大模型，消耗少量额度）' : '（仅本地测量，不调用大模型）'}。`,
      ok: '重新拆解',
    })
    if (!ok) return
    return runReferenceJob('正在重新拆解参考视频…', () => PK.postP('reference/analyze', { videoPath, async: true, useVision: vision, extractAudioAsBgm: REF_PREFS.extractAudio, applyToScript: true }))
  }
  let llmCache = null
  const llmReady = () => {
    const d = PK.store.data
    if (d && d.llmConfig) llmCache = Boolean(d.llmConfig.configured)
    return Boolean(llmCache)
  }

  function refOptions(ctx) {
    const vOk = llmReady()
    return ui.stack([
      ui.toggle({
        value: REF_PREFS.extractAudio,
        label: '同时提取参考片音轨作为 BGM',
        hint: '把参考视频的背景音乐抽出来，直接用作你这支片子的配乐（注意版权）',
        onChange: (v) => (REF_PREFS.extractAudio = v),
      }),
      ui.toggle({
        value: REF_PREFS.useVision && vOk,
        label: 'AI 视觉深度拆解（多模态大模型）',
        hint: vOk ? '读懂画风、人物、特效与镜头公式，复刻更像；会消耗少量大模型额度。关闭则只做本地测量（镜头切点 / BPM / 配色）' : '还没有配置 AI 大模型，本次只做本地测量（镜头切点 / BPM / 关键帧），同样可以复刻节奏',
        onChange: (v) => {
          REF_PREFS.useVision = v
          if (v && !llmReady()) {
            PK.toast('需要先配置支持图片的大模型才能做视觉拆解', 'warn', { action: { label: '去配置', onClick: () => PK.open('keys', { tab: 'llm' }) } })
            REF_PREFS.useVision = false
            ctx.render()
          }
        },
      }),
    ])
  }

  function refJobNote() {
    const j = REF.job
    if (!j) return null
    const sec = Math.round((Date.now() - j.startedAt) / 1000)
    return ui.note(h('div.pk-stack', null, ui.meter(j.pct, { label: j.message || j.label, valueText: `${Math.round(j.pct)}%` }), h('p.pk-ops-sub', null, `已用时 ${U.fmtDur(sec)} · 可以先关闭面板，拆解完成后会自动提示`)), {
      level: 'info',
      title: '参考视频拆解中',
    })
  }

  function cutsBar(rs) {
    const total = finite(rs.durationSec)
    const cuts = (Array.isArray(rs.cutTimestamps) ? rs.cutTimestamps : []).map((x) => num(typeof x === 'object' ? x.t || x.time : x)).filter((x) => x > 0 && x < total)
    const drops = (Array.isArray(rs.drops) ? rs.drops : []).map((x) => num(typeof x === 'object' ? x.t || x.time : x)).filter((x) => x > 0 && x < total)
    if (!total || (!cuts.length && !drops.length)) return null
    return ui.section(
      { title: '镜头切点与高潮突降', en: 'CUT MAP', desc: `蓝色竖线 = 实测剪辑切点（${cuts.length} 处），金色 = 音乐高潮突降点（${drops.length} 处）` },
      h(
        'div.pk-ops-cuts',
        { role: 'img', 'aria-label': `参考片 ${cuts.length} 个切点` },
        cuts.map((t) => h('i', { style: { left: `${(t / total) * 100}%` }, title: `切点 ${t.toFixed(2)}s` })),
        drops.map((t) => h('i.is-drop', { style: { left: `${(t / total) * 100}%` }, title: `突降 ${t.toFixed(2)}s` })),
      ),
      h('div.pk-ops-axis', null, h('span', null, '0s'), h('span', null, `${(total / 2).toFixed(1)}s`), h('span', null, `${total.toFixed(1)}s`)),
    )
  }

  function refDnaView(ctx) {
    const L = ctx.local
    const ap = (ctx.data && ctx.data.activeProject) || {}
    const script = ap.script || {}
    const rs = script.referenceStyle
    const videoRel = refSource(ap, rs)
    if (!rs) {
      return [
        refJobNote(),
        REF.lastError && !REF.job ? ui.note(REF.lastError, { level: 'error', title: '上一次拆解没有成功', actions: [ui.btn('知道了', () => ((REF.lastError = ''), ctx.render()), { size: 'sm' })] }) : null,
        ui.split(
          [
            ui.section(
              { title: '上传一段爆款参考视频', en: 'UPLOAD REFERENCE', icon: 'upload', desc: 'AI 会实测它的镜头数、平均镜长、快切、BPM 与高潮点，并拆解画风、人物特效、转场与字幕风格，生成可复用的「同款复刻基因」和 MOTION.md。' },
              REF.job
                ? ui.empty({ icon: 'target', title: '正在拆解中…', text: '完成后这里会显示它的风格基因。' })
                : ui.drop({
                    label: '拖入参考视频，或点击选择',
                    hint: 'mp4 / mov / webm / mkv · 建议 2 分钟以内',
                    accept: VIDEO_ACCEPT,
                    icon: 'film',
                    onFiles: async (files) => {
                      await uploadReference(files[0]).catch((err) => PK.reportError(err, '参考视频上传拆解失败'))
                    },
                  }),
              refOptions(ctx),
            ),
          ],
          [
            ui.section(
              { title: '复刻同款，三步就好', en: 'HOW IT WORKS', icon: 'help' },
              ui.steps([
                { label: '上传参考片', sub: '任意爆款短视频 / 广告片', state: 'todo' },
                { label: 'AI 拆解风格基因', sub: '镜头节奏 · BPM · 配色 · 转场', state: 'todo' },
                { label: '写你的新主题，一键出片', sub: '同款节奏，内容换成你的', state: 'todo' },
              ]),
              videoRel
                ? ui.note(`工程里已经有一段参考视频（${U.baseName(videoRel)}），可以直接重新拆解，不用再上传。`, {
                    level: 'info',
                    actions: [ui.btn('直接重新拆解', () => reanalyzeReference(videoRel).catch((err) => PK.reportError(err, '重新拆解失败')), { size: 'sm', icon: 'retry', busyText: '拆解中…', disabled: Boolean(REF.job) })],
                  })
                : null,
            ),
          ],
          { ratio: 'minmax(0, 1.2fr) minmax(0, 1fr)' },
        ),
      ]
    }
    const pal = swatches(rs.colorPalette)
    const formula = Array.isArray(rs.shotFormula) ? rs.shotFormula : []
    const stats = [
      [rs.durationSec ? `${num(rs.durationSec).toFixed(1)}s` : '—', '参考片时长'],
      [String(rs.shotCount || 0), '实测镜头数'],
      [rs.avgShotSec ? `${rs.avgShotSec}s` : '—', '平均镜长'],
      [rs.minShotSec ? `${rs.minShotSec}s` : '—', '最短镜头'],
      [String(rs.blitzCutCount || 0), '高燃快切'],
      [rs.bpm ? String(Math.round(rs.bpm)) : '—', '音乐 BPM'],
      [String(rs.dropsCount || (rs.drops || []).length || 0), '高潮突降'],
    ]
    return [
      refJobNote(),
      REF.lastError && !REF.job ? ui.note(REF.lastError, { level: 'error', title: '上一次拆解没有成功', actions: [ui.btn('知道了', () => ((REF.lastError = ''), ctx.render()), { size: 'sm' })] }) : null,
      rs.visionError ? ui.note(`视觉大模型这次没有成功（${rs.visionError}），已用本地测量结果生成复刻基因，节奏数据仍然准确。`, { level: 'warn', title: 'AI 视觉拆解未完成' }) : null,
      rs.plazaTemplateId && !rs.sourceRelPath
        ? ui.note(
            `这份同款复刻基因来自影核广场模板「${rs.title || rs.genreLabel || rs.plazaTemplateId}」，不是上传的参考视频，所以没有关键帧与实测镜头切点。${
              videoRel ? `工程里仍保留着之前上传的参考视频（${U.baseName(videoRel)}），点「重新拆解」可以改回按它复刻；也可以「换参考片」。` : '想复刻某条爆款视频的节奏？点右下角「上传参考视频」即可替换。'
            }`,
            { level: 'info', title: '基因来源：影核广场模板' },
          )
        : null,
      h(
        'div.pk-ops-dna',
        null,
        h(
          'div.pk-stack',
          null,
          rs.sheetRelPath
            ? (() => {
                const src = fileUrl(rs.sheetRelPath, rs.analyzedAt || 'ref')
                const b = h('button.pk-ops-sheet', { type: 'button', title: '点击放大查看 9 宫格关键帧', 'aria-label': '放大查看参考片 9 宫格关键帧' }, h('img', { src, alt: '参考视频 3×3 关键帧', draggable: 'false' }))
                b.addEventListener('click', () => openImageViewer('参考片 3×3 关键帧', src, 'CONTACT SHEET · 9 FRAMES'))
                return b
              })()
            : null,
          h('div.pk-ops-stats', null, stats.map(([v, l]) => ui.stat(v, l))),
          cutsBar(rs),
        ),
        h(
          'div.pk-stack',
          null,
          ui.section(
            {
              title: rs.title || rs.genreLabel || '同款复刻基因',
              en: 'STYLE DNA',
              icon: 'target',
              actions: [
                rs.plazaTemplateId && !rs.sourceRelPath
                  ? ui.pill('影核广场模板基因', 'acc')
                  : ui.pill(rs.visionAnalyzed ? `AI 视觉已拆解${rs.visionModel ? ` · ${rs.visionModel}` : ''}` : '本地实测（未调用视觉大模型）', rs.visionAnalyzed ? 'ok' : 'mute'),
              ],
            },
            ui.kv(
              [
                ['参考片', rs.sourceName || U.baseName(videoRel) || '—'],
                ['体裁风格', [rs.genreLabel, PK.optionLabel('styles', rs.style, rs.style || '')].filter(Boolean).join(' · ') || '—'],
                ['画面规格', [rs.width && rs.height ? `${rs.width}×${rs.height}` : '', rs.aspectRatio, rs.fps ? `${Math.round(rs.fps)} fps` : ''].filter(Boolean).join(' · ') || '—'],
                ['配音节奏', PK.optionLabel('narrationModes', rs.narrationMode, rs.narrationMode === 'subtitle-mv' ? '纯音乐卡点' : rs.narrationMode || '—')],
                ['推荐节奏', PK.optionLabel('pacingModes', rs.pacingSignature && rs.pacingSignature.recommendedPacingMode, (rs.pacingSignature && rs.pacingSignature.recommendedPacingMode) || '—')],
                ['字幕风格', rs.subtitleStyle === 'pill' ? '胶囊字幕' : '电影字幕'],
                rs.analyzedAt ? ['拆解时间', U.fmtTime(rs.analyzedAt)] : null,
              ].filter(Boolean),
            ),
            pal,
          ),
          rs.visualStyle ? ui.section({ title: '画面风格', en: 'VISUAL' }, h('p.pk-ops-body', null, rs.visualStyle)) : null,
          rs.characterDesign ? ui.section({ title: '人物与主体', en: 'CHARACTER' }, h('p.pk-ops-body', null, rs.characterDesign)) : null,
          (rs.transitionSignature || []).length || (rs.vfxSignature || []).length
            ? ui.section(
                { title: '转场与特效签名', en: 'SIGNATURE' },
                (rs.transitionSignature || []).length ? ui.row(rs.transitionSignature.map((x) => ui.tag(transitionLabel(x), { active: true }))) : null,
                (rs.vfxSignature || []).length ? ui.row(rs.vfxSignature.map((x) => ui.tag(String(x)))) : null,
                rs.subtitleNotes ? h('p.pk-ops-body', null, rs.subtitleNotes) : null,
              )
            : null,
        ),
      ),
      formula.length
        ? ui.section(
            { title: '镜头公式', en: 'SHOT FORMULA', icon: 'film', count: formula.length },
            h(
              'div.pk-ops-formula',
              null,
              formula.map((f) => h('div.pk-ops-fx', null, h('b', null, f.phase || '阶段'), h('span', null, f.pctRange || ''), h('p', null, [f.visualMotif, f.transition ? `转场：${transitionLabel(f.transition)}` : ''].filter(Boolean).join(' · ')))),
            ),
          )
        : null,
      rs.replicationPrompt
        ? ui.section(
            { title: '同款复刻指导指令', en: 'REPLICATION PROMPT', icon: 'wand', desc: '下一次出片时，AI 导演和动效编程会按这段指令复刻同款。', actions: [ui.btn('放大查看', () => openTextViewer('同款复刻指导指令', 'REPLICATION PROMPT', rs.replicationPrompt), { size: 'sm', icon: 'expand' })] },
            h('p.pk-ops-body', null, rs.replicationPrompt),
          )
        : null,
      ui.section({ title: '拆解选项', en: 'OPTIONS', desc: '用于「换参考片」和「重新拆解」' }, refOptions(ctx)),
    ]
  }

  /* ---- synced compare player (reference vs remake) ---- */
  function cmpController(ctx) {
    const L = ctx.local
    if (L.cmp) return L.cmp
    const C = { playing: false, dur: 0, speed: 1, audio: 'remake', mode: 'split', pct: 50, err: {}, ui: {}, timer: 0 }
    const mk = (who) => {
      const v = document.createElement('video')
      v.className = 'pk-ops-cmp-v'
      v.preload = 'auto'
      v.playsInline = true
      v.setAttribute('playsinline', '')
      v.muted = who === 'ref'
      v.addEventListener('loadedmetadata', () => {
        C.dur = Math.max(finite(C.ref.duration), finite(C.rem.duration))
        C.err[who] = ''
        paint()
      })
      v.addEventListener('timeupdate', paint)
      v.addEventListener('ended', () => {
        if ((C.ref.ended || !C.ref.src) && (C.rem.ended || !C.rem.src)) {
          C.playing = false
          stopSync()
          paint()
        }
      })
      v.addEventListener('error', () => {
        if (!v.getAttribute('src')) return
        C.err[who] = who === 'ref' ? '参考视频加载失败（文件可能已被移动或删除），可以在「风格基因」里重新上传。' : '成片加载失败：文件可能正在重新渲染，稍后点「重新加载」。'
        ctx.update()
      })
      return v
    }
    C.ref = mk('ref')
    C.rem = mk('rem')
    const leader = () => (C.audio === 'ref' ? C.ref : C.rem)
    const follower = () => (C.audio === 'ref' ? C.rem : C.ref)
    /** the shared playhead: the audible (leading) video, or the longer one once the leader has ended */
    C.now = () => {
      const a = leader()
      return a.getAttribute('src') && !a.ended ? a.currentTime || 0 : Math.max(C.ref.currentTime || 0, C.rem.currentTime || 0)
    }
    C.clockText = () => `${clock(C.now())} / ${clock(C.dur)}`
    function paint() {
      const u = C.ui
      const shown = C.now()
      if (u.range && !u.dragging) {
        u.range.max = String(Math.max(1, C.dur))
        u.range.value = String(shown)
        u.range.style.setProperty('--pk-fill', `${C.dur ? U.clamp((shown / C.dur) * 100, 0, 100) : 0}%`)
      }
      if (u.clock) u.clock.textContent = C.clockText()
      if (u.play && u.lastPlaying !== C.playing) {
        u.lastPlaying = C.playing
        const l = u.play.querySelector('.pk-btn-l')
        if (l) l.textContent = C.playing ? '同步暂停' : '同步播放'
        const ic = u.play.querySelector('svg')
        if (ic) ic.replaceWith(PK.icon(C.playing ? 'pause' : 'play', 15))
      }
    }
    function stopSync() {
      clearInterval(C.timer)
      C.timer = 0
    }
    function startSync() {
      stopSync()
      C.timer = setInterval(() => {
        if (!C.playing) return stopSync()
        const a = leader()
        const b = follower()
        if (a.ended || b.ended || a.paused || !b.src || !a.src) return
        const drift = a.currentTime - b.currentTime
        if (Math.abs(drift) > 0.18 && a.currentTime < finite(b.duration)) {
          try {
            b.currentTime = a.currentTime
          } catch {}
        }
      }, 300)
    }
    C.applyAudio = () => {
      C.ref.muted = C.audio !== 'ref'
      C.rem.muted = C.audio !== 'remake'
    }
    C.applySpeed = () => {
      C.ref.playbackRate = C.speed
      C.rem.playbackRate = C.speed
    }
    C.play = () => {
      const t = Math.min(C.ref.currentTime || 0, C.rem.currentTime || 0)
      for (const v of [C.ref, C.rem]) {
        try {
          v.currentTime = Math.min(t, finite(v.duration) || t)
        } catch {}
      }
      C.applySpeed()
      C.applyAudio()
      let started = 0
      for (const v of [C.ref, C.rem]) {
        if (!v.getAttribute('src')) continue
        if (finite(v.duration) && t >= finite(v.duration) - 0.05) continue
        started++
        const pr = v.play()
        if (pr && typeof pr.catch === 'function')
          pr.catch((err) => {
            if (err && err.name === 'NotAllowedError') {
              v.muted = true
              v.play().catch(() => {})
              PK.toast('浏览器拦截了自动播放声音，已先静音播放，可在下方切换音轨', 'info')
            }
          })
      }
      if (!started) {
        C.seek(0)
        return C.play()
      }
      C.playing = true
      startSync()
      paint()
    }
    C.pause = () => {
      C.ref.pause()
      C.rem.pause()
      C.playing = false
      stopSync()
      paint()
    }
    C.toggle = () => (C.playing ? C.pause() : C.play())
    C.seek = (sec) => {
      const t = Math.max(0, num(sec))
      for (const v of [C.ref, C.rem]) {
        try {
          v.currentTime = Math.min(t, finite(v.duration) || t)
        } catch {}
      }
      paint()
    }
    C.paint = paint
    C.setSources = (refSrc, remSrc) => {
      let changed = false
      for (const [v, src] of [
        [C.ref, refSrc],
        [C.rem, remSrc],
      ]) {
        if ((v.getAttribute('src') || '') === (src || '')) continue
        changed = true
        C.pause()
        if (src) v.src = src
        else releaseMedia(v)
      }
      if (changed) {
        C.err = {}
        C.dur = Math.max(finite(C.ref.duration), finite(C.rem.duration))
      }
    }
    C.release = () => {
      stopSync()
      releaseMedia(C.ref)
      releaseMedia(C.rem)
    }
    L.cmp = C
    ctx.onCleanup(() => C.release())
    return C
  }

  function refCompareView(ctx) {
    const L = ctx.local
    const ap = (ctx.data && ctx.data.activeProject) || {}
    const script = ap.script || {}
    const rs = script.referenceStyle || null
    const s = st()
    const hasMp4 = Boolean(ap.hasMp4 || (s.preview && s.preview.hasMp4))
    const refRel = refSource(ap, rs)
    const hasRef = Boolean(refRel || ap.hasReferenceVideo)
    if (!hasMp4 || !hasRef) {
      if (L.cmp) L.cmp.pause()
      return [
        ui.empty({
          icon: 'split',
          title: '还不能对比',
          text: !hasRef && !hasMp4 ? '同步对比需要「参考视频」和「复刻成片」两段画面：先上传参考片拆解基因，再一键出片。' : !hasRef ? '还没有参考视频：先在「风格基因」里上传一段参考片。' : '还没有复刻成片：写好新主题后点「一键出片」，出片完成后就能左右对比。',
          actions: [
            !hasRef ? ui.btn('去上传参考片', () => ((L.tab = 'dna'), ctx.render()), { icon: 'upload', kind: 'primary' }) : null,
            hasRef && !hasMp4 ? ui.btn('查看任务中心', () => PK.open('tasks'), { icon: 'tasks' }) : null,
          ],
        }),
      ]
    }
    const C = cmpController(ctx)
    // cache key: a new analysis (换参考片 overwrites reference/ref-source.*) or 「重新加载画面」 forces a fresh load
    const refSrc = refRel ? fileUrl(refRel, `${(rs && rs.analyzedAt) || 'ref'}|${L.refv || ''}`) : PK.routeUrl('reference/video', { projectDir: PK.dir(), v: L.refv || 'ref' })
    const remSrc = fileUrl('output/final.mp4', L.mp4v || 'cur')
    C.setSources(refSrc, remSrc)
    const scenes = Array.isArray(script.scenes) ? script.scenes : []
    const remDur = finite(script.totalDurationSec) || scenes.reduce((a, x) => a + finite(x.durationSec), 0)
    const remBpm = finite(script.bgm && script.bgm.bpm)
    const curtain = C.mode === 'curtain'
    const pane = (who, video, extra) =>
      h(
        'div.pk-ops-pane',
        null,
        video,
        C.err[who === 'ref' ? 'ref' : 'rem'] ? h('div.pk-ops-perr', null, C.err[who === 'ref' ? 'ref' : 'rem']) : null,
        extra || null,
      )
    let stage
    if (!curtain) {
      stage = h(
        'div.pk-ops-cmp',
        { 'aria-label': '左右并排对比' },
        pane('ref', C.ref, h('span.pk-ops-tagv.is-l', null, '参考原片')),
        pane('rem', C.rem, h('span.pk-ops-tagv.is-l', { style: { background: 'var(--pk-acc)', color: 'var(--pk-acc-ink)' } }, '复刻成片')),
      )
    } else {
      const clip = h('div.pk-ops-clip', { style: { clipPath: `inset(0 ${100 - C.pct}% 0 0)` } }, C.ref)
      const div = h('div.pk-ops-div', { style: { left: `${C.pct}%` } }, h('span.pk-ops-knob', null, PK.icon('split', 15)))
      const inner = h('div.pk-ops-pane', null, C.rem, clip, div, h('span.pk-ops-tagv.is-l', null, '◀ 参考原片'), h('span.pk-ops-tagv.is-r', null, '复刻成片 ▶'), C.err.ref || C.err.rem ? h('div.pk-ops-perr', null, C.err.ref || C.err.rem) : null)
      stage = h('div.pk-ops-cmp.is-curtain', { role: 'slider', tabindex: '0', 'aria-label': '拉帘位置：左边是参考原片，右边是复刻成片', 'aria-valuemin': '5', 'aria-valuemax': '95', 'aria-valuenow': String(Math.round(C.pct)) }, inner)
      const setPct = (p) => {
        C.pct = U.clamp(p, 5, 95)
        clip.style.clipPath = `inset(0 ${100 - C.pct}% 0 0)`
        div.style.left = `${C.pct}%`
        stage.setAttribute('aria-valuenow', String(Math.round(C.pct)))
      }
      const move = (ev) => {
        const r = stage.getBoundingClientRect()
        if (r.width > 0) setPct(((ev.clientX - r.left) / r.width) * 100)
      }
      stage.addEventListener('pointerdown', (ev) => {
        try {
          stage.setPointerCapture(ev.pointerId)
        } catch {}
        move(ev)
        stage.addEventListener('pointermove', move)
      })
      const end = () => stage.removeEventListener('pointermove', move)
      stage.addEventListener('pointerup', end)
      stage.addEventListener('pointercancel', end)
      stage.addEventListener('keydown', (ev) => {
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          ev.preventDefault()
          setPct(C.pct + (ev.key === 'ArrowLeft' ? -4 : 4))
        }
      })
    }
    // the transport is rebuilt on every render: start it at the real playhead (not 0) so it never flashes back
    const now = C.now()
    const range = h('input.pk-range', { type: 'range', min: '0', max: String(Math.max(1, C.dur)), step: '0.1', value: String(now), 'aria-label': '同步进度', style: { '--pk-fill': `${C.dur ? U.clamp((now / C.dur) * 100, 0, 100) : 0}%` } })
    range.addEventListener('pointerdown', () => (C.ui.dragging = true))
    for (const t of ['pointerup', 'pointercancel', 'change']) range.addEventListener(t, () => (C.ui.dragging = false))
    range.addEventListener('input', () => {
      C.seek(Number(range.value))
      range.style.setProperty('--pk-fill', `${C.dur ? (Number(range.value) / C.dur) * 100 : 0}%`)
    })
    const playBtn = ui.btn(C.playing ? '同步暂停' : '同步播放', () => C.toggle(), { kind: 'primary', icon: C.playing ? 'pause' : 'play' })
    const clockEl = h('span.pk-ops-clock', null, C.clockText())
    C.ui = { range, clock: clockEl, play: playBtn }
    requestAnimationFrame(() => C.paint())
    // the measured columns only describe the reference VIDEO — a 影核广场 template's DNA is not measured from it
    const rv = rs && !rs.plazaTemplateId ? rs : null
    const refShots = rv ? num(rv.shotCount) : 0
    const refAvg = rv ? num(rv.avgShotSec) : 0
    const remAvg = scenes.length && remDur ? remDur / scenes.length : 0
    const rows = [
      { k: '镜头数', a: refShots ? `${refShots} 镜` : '—', b: scenes.length ? `${scenes.length} 镜` : '—' },
      { k: '平均镜长', a: refAvg ? `${refAvg.toFixed(2)}s` : '—', b: remAvg ? `${remAvg.toFixed(2)}s` : '—' },
      { k: '音乐 BPM', a: rv && rv.bpm ? String(Math.round(rv.bpm)) : '—', b: remBpm ? String(Math.round(remBpm)) : '—' },
      { k: '时长', a: rv && rv.durationSec ? `${num(rv.durationSec).toFixed(1)}s` : '—', b: remDur ? `${remDur.toFixed(1)}s` : '—' },
    ]
    return [
      ui.row(
        [
          ui.seg({ value: C.mode, options: [{ value: 'split', label: '左右并排', icon: 'split' }, { value: 'curtain', label: '拉帘叠加', icon: 'layers' }], onChange: (v) => ((C.mode = v), ctx.render()) }),
          h('p.pk-ops-sub.pk-ops-grow', null, curtain ? '在画面上左右拖动金色分割线，左边是参考原片，右边是复刻成片。' : '两段画面按同一时间轴同步播放、同步拖动进度。'),
        ],
        { between: true },
      ),
      stage,
      h(
        'div.pk-ops-transport',
        null,
        playBtn,
        ui.iconBtn('retry', () => (C.pause(), C.seek(0)), { title: '回到开头' }),
        range,
        clockEl,
      ),
      ui.row([
        h('span.pk-ops-sub', null, '音轨'),
        ui.seg({
          value: C.audio,
          options: [
            { value: 'remake', label: '听复刻成片', icon: 'voice' },
            { value: 'ref', label: '听参考原片', icon: 'voice' },
            { value: 'mute', label: '双轨静音', icon: 'minus' },
          ],
          onChange: (v) => {
            C.audio = v
            C.applyAudio()
          },
        }),
        h('span.pk-ops-sub', null, '速度'),
        ui.seg({
          value: String(C.speed),
          options: ['0.5', '0.75', '1', '1.25', '1.5', '2'].map((x) => ({ value: x, label: `${x}×` })),
          onChange: (v) => {
            C.speed = Number(v) || 1
            C.applySpeed()
          },
        }),
      ]),
      ui.section(
        { title: '节奏对照', en: 'RHYTHM CHECK', icon: 'wave', desc: '参考原片的实测数据 vs 复刻成片的分镜数据，越接近说明节奏复刻得越像。' },
        ui.table({ columns: [{ key: 'k', label: '指标' }, { key: 'a', label: '参考原片' }, { key: 'b', label: '复刻成片' }], rows }),
      ),
    ]
  }

  PK.panel('reference', {
    title: '参考复刻',
    en: 'REFERENCE REMAKE · 拆解爆款节奏 · 同款复刻 · 同步对比',
    idx: 'RF',
    icon: 'target',
    kind: 'modal',
    size: 'xl',
    group: 'tools',
    order: 40,
    desc: '上传爆款参考片，拆解镜头节奏与风格，并和成片同步对比',
    needsProject: true,
    aliases: { ref: {}, compare: { tab: 'compare' }, referenceVideo: {}, remake: {}, refCompare: { tab: 'compare' } },
    watch: (s) => [s && s.project && s.project.dir, s && s.rev, s && s.preview && s.preview.hasMp4, s && s.projectFlags && s.projectFlags.hasReferenceVideo],
    onWatch(ctx) {
      if (!PK.hasProject()) {
        ctx.close()
        return
      }
      if (ctx.local.dir !== dirKey()) {
        ctx.local.dir = dirKey()
        if (ctx.local.cmp) ctx.local.cmp.setSources('', '')
      }
      ctx.load(true)
    },
    mount(ctx) {
      const L = ctx.local
      L.dir = dirKey()
      L.tab = ctx.args.tab === 'compare' ? 'compare' : 'dna'
      const onJob = () => ctx.update()
      REF.listeners.add(onJob)
      ctx.onCleanup(() => REF.listeners.delete(onJob))
      ctx.every(1000, () => REF.job && ctx.update())
      ctx.listen('event:run-finished', (d) => {
        if (d && d.status === 'completed') L.mp4v = d.runId || String(Date.now())
      })
      ctx.load()
    },
    onArgs(ctx, a) {
      if (a.tab) ctx.local.tab = a.tab === 'compare' ? 'compare' : 'dna'
      ctx.render()
    },
    render(ctx) {
      const L = ctx.local
      if (!ctx.data) return ctx.loadError ? ui.errorBox(ctx.loadError, () => ctx.load(true)) : ui.loading('正在读取参考复刻数据…')
      if (ctx.data.llmConfig) llmCache = Boolean(ctx.data.llmConfig.configured)
      const ap = ctx.data.activeProject || {}
      const rs = (ap.script && ap.script.referenceStyle) || null
      const videoRel = refSource(ap, rs)
      const canCompare = Boolean((ap.hasMp4 || (st().preview && st().preview.hasMp4)) && (videoRel || ap.hasReferenceVideo))
      if (L.tab !== 'compare' && L.cmp) L.cmp.pause()
      const busy = Boolean(REF.job)
      const changeRef = async () => {
        const files = await PK.pickFiles({ accept: VIDEO_ACCEPT })
        if (files.length) await uploadReference(files[0]).catch((err) => PK.reportError(err, '参考视频上传拆解失败'))
      }
      if (L.tab === 'compare')
        ctx.foot([
          ui.hint(canCompare ? '提示：拉帘模式适合逐帧比对构图和色调；并排模式适合整体看节奏。' : '需要参考视频和成片才能对比'),
          ui.spacer(),
          canCompare
            ? ui.btn('重新加载画面', () => {
                L.mp4v = String(Date.now())
                L.refv = String(Date.now())
                if (L.cmp) L.cmp.setSources('', '')
                ctx.render()
              }, { icon: 'refresh', kind: 'ghost' })
            : null,
          ui.btn('风格基因', () => ((L.tab = 'dna'), ctx.render()), { icon: 'target' }),
        ])
      else
        ctx.foot([
          busy
            ? ui.spinner('拆解中…')
            : ui.hint(rs ? `已锁定同款基因 · ${rs.shotCount || 0} 镜 · ${rs.bpm || '?'} BPM` : videoRel ? '参考视频已在工程里，还没有拆解出复刻基因' : '还没有参考视频'),
          ui.spacer(),
          rs ? ui.btn('清除参考基因', async () => {
            const ok = await PK.confirm({ title: '清除参考复刻基因？', text: '清除后，下一次出片不再按这段参考片的节奏和风格复刻（参考视频文件仍保留在工程的 reference 文件夹里，可随时重新拆解）。', ok: '清除', danger: true })
            if (!ok) return
            await PK.postP('reference/clear', {})
            try {
              await PK.action('refresh', { syncForm: true })
            } catch {}
            PK.store.invalidate()
            PK.toast('已清除当前工程绑定的参考视频基因', 'info')
            ctx.load(true)
          }, { icon: 'trash', kind: 'danger', disabled: busy, busyText: '清除中…' }) : null,
          rs ? ui.btn('导出 MOTION.md', async () => {
            const d = await PK.postP('motion-md', {})
            PK.toast(`✓ 已导出可跨智能体复用的分镜蓝图：${(d && d.relPath) || 'MOTION.md'}`, 'success')
            if (d && d.content) openTextViewer('MOTION.md · 分镜蓝图', 'MOTION.md · 已写入工程根目录', String(d.content), { hint: '已写入工程根目录的 MOTION.md，可交给任何 AI 智能体复用同款节奏与画面。' })
          }, { icon: 'code', busyText: '导出中…' }) : null,
          // re-analysis needs the source video (a 影核广场 template's DNA has none)
          videoRel ? ui.btn('重新拆解', () => reanalyzeReference(videoRel).catch((err) => PK.reportError(err, '重新拆解失败')), { icon: 'retry', disabled: busy, busyText: '拆解中…' }) : null,
          ui.btn(videoRel ? '换参考片' : '上传参考视频', changeRef, { kind: 'primary', icon: 'upload', disabled: busy, busyText: '上传中…' }),
        ])
      return [
        ui.tabs({
          value: L.tab,
          items: [
            { value: 'dna', label: '风格基因', icon: 'target', badge: rs ? `${rs.shotCount || 0} 镜` : '' },
            { value: 'compare', label: '同步对比', icon: 'split', badge: canCompare ? '可对比' : '' },
          ],
          onChange: (v) => {
            L.tab = v
            ctx.render()
          },
        }),
        ...(L.tab === 'compare' ? refCompareView(ctx) : refDnaView(ctx)),
      ]
    },
  })

  /* ================================================================ 4 · 提词器录制 TELEPROMPTER */
  const TELE_DEFAULT_TEXT = '欢迎来到 DSH 电影视频工坊。\n只要在这里导入素材或现场录制一段口播，\n四位 AI 智能体就会协同完成分镜、剪辑、配音混音与 1080P 成片渲染。'
  const TELE = { text: '', speed: 1.1, font: 26, lh: 1.65, opacity: 0.62, mirrorCam: true, mirrorText: false, clone: true, role: 'host_video', layout: 'side', durationSec: 45 }
  const TELE_ROLES = [
    { value: 'host_video', label: '真人出镜主镜头', hint: '直接用作视频口播与原声片源（host_video）' },
    { value: 'avatar_base', label: '克隆数字人底板', hint: '用它来合成「克隆版你自己」的数字人（avatar_base）' },
  ]
  /**
   * Base64 of a recording. NOT PK.util.fileToBase64: MediaRecorder blobs are typed like `video/webm;codecs=vp9,opus`,
   * so their data URL has a comma INSIDE the MIME type and "everything after the first comma" starts with
   * `opus;base64,` — the server then decodes a misaligned stream and saves a corrupt file. Re-typing the blob as
   * octet-stream and splitting on `;base64,` is safe for every type.
   */
  const blobToBase64 = (blob) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => {
        const s = String(fr.result || '')
        const i = s.indexOf(';base64,')
        resolve(i >= 0 ? s.slice(i + 8) : s.slice(s.indexOf(',') + 1))
      }
      fr.onerror = () => reject(fr.error || new Error('读取录像失败'))
      fr.readAsDataURL(new Blob([blob], { type: 'application/octet-stream' }))
    })
  const pickRecMime = (hasVideo) => {
    if (typeof MediaRecorder === 'undefined') return ''
    const list = hasVideo
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    for (const m of list) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return m
      } catch {}
    }
    return ''
  }

  function teleController(ctx) {
    const L = ctx.local
    if (L.T) return L.T
    const T = { stream: null, rec: null, chunks: [], recSec: 0, recTimer: 0, countN: 0, countTimer: 0, auto: false, raf: 0, pos: 0, ac: null, vuRaf: 0, vuLast: 0, take: null, error: '', note: '', starting: false }
    T.video = h('video.pk-ops-vf-video', { 'aria-label': '摄像头实时画面' })
    T.video.muted = true
    T.video.playsInline = true
    T.video.setAttribute('playsinline', '')
    T.video.autoplay = true
    T.empty = h('div.pk-ops-vf-empty')
    T.recPill = h('div.pk-ops-rec', { hidden: true, role: 'status' }, h('i'), h('span', null, 'REC 00:00'))
    T.count = h('div.pk-ops-count', { hidden: true, role: 'status', 'aria-live': 'assertive' }, h('b', null, '3'), h('span', null, '准备就绪，马上开始录制与自动滚词…'))
    T.vf = h('div.pk-ops-vf', null, T.video, T.empty, T.recPill, T.count)
    T.textEl = h('div.pk-ops-ptext')
    T.box = h('div.pk-ops-pbox', { 'data-pk-scroll': 'tele-prompter', tabindex: '0', 'aria-label': '提词板（可用滚轮手动滚动）' }, h('div.pk-ops-pad-t'), T.textEl, h('div.pk-ops-pad-b'))
    T.readline = h('i.pk-ops-readline', { 'aria-hidden': 'true' })
    T.pwrap = h('div.pk-ops-pwrap', null, T.box, T.readline)
    T.vuFill = h('i')
    T.vuVal = h('b', null, '0%')
    T.vuIcon = h('span', { style: { display: 'grid', color: 'var(--pk-ink3)' } }, PK.icon('mic', 15))
    T.vu = h('div.pk-ops-vu', { role: 'meter', 'aria-label': '麦克风收音电平', 'aria-valuemin': '0', 'aria-valuemax': '100' }, T.vuIcon, h('span', null, '麦克风收音电平'), h('div.pk-ops-vu-t', null, T.vuFill), T.vuVal)
    T.box.addEventListener('scroll', () => {
      if (Math.abs(T.box.scrollTop - Math.round(T.pos)) > 2) T.pos = T.box.scrollTop
    })
    T.box.addEventListener('dblclick', () => setAuto(!T.auto))

    function applyStyle() {
      T.textEl.textContent = TELE.text
      T.box.style.fontSize = `${TELE.font}px`
      T.box.style.lineHeight = String(TELE.lh)
      T.box.style.background = `rgba(5, 8, 16, ${TELE.opacity})`
      T.textEl.style.transform = TELE.mirrorText ? 'scaleX(-1)' : ''
      T.video.style.transform = TELE.mirrorCam ? 'scaleX(-1)' : ''
      T.readline.style.height = `${Math.round(TELE.font * TELE.lh + 6)}px`
    }
    /** only tracks that still deliver media count (a camera can end on its own: unplugged, taken by another app, driver) */
    const liveTracks = (kind) =>
      T.stream ? (kind === 'video' ? T.stream.getVideoTracks() : kind === 'audio' ? T.stream.getAudioTracks() : T.stream.getTracks()).filter((t) => t.readyState === 'live') : []
    T.hasLiveVideo = () => liveTracks('video').length > 0
    function paintEmpty() {
      PK.clear(T.empty)
      const hasVideo = T.hasLiveVideo()
      T.empty.hidden = hasVideo
      T.empty.classList.toggle('is-err', Boolean(T.error))
      if (hasVideo) return
      if (T.stream) {
        PK.append(T.empty, PK.icon('mic', 30), h('b', null, T.note || '🎙 纯麦克风录音模式：摄像头不可用，录制的是你的声音（可用于配音 / 声纹克隆）'))
        return
      }
      PK.append(
        T.empty,
        PK.icon('cam', 30),
        h('b', null, T.error || (T.starting ? '正在请求摄像头与麦克风权限…（如果浏览器弹出提示，请点「允许」）' : '点击下方「开启摄像头与麦克风」即可测试收音并开始拍摄')),
        T.error
          ? h(
              'div.pk-row.pk-row--wrap',
              null,
              ui.btn('上传本机已录视频 / 音频入库', () => importLocal(), { size: 'sm', icon: 'upload', kind: 'primary', busyText: '上传中…' }),
              ui.btn('在系统浏览器中打开自拍', async () => {
                // classic: the local studio address (or the default standalone studio) is copied AND opened, because a
                // desktop host's embedded frame may not be allowed to ask for camera permission
                const origin = (() => {
                  try {
                    return window.top.location.origin
                  } catch {
                    return location.origin
                  }
                })()
                const url = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin) ? origin : 'http://127.0.0.1:4399'
                const ok = await U.copyText(url)
                try {
                  window.open(url, '_blank', 'noopener,noreferrer')
                } catch {}
                PK.toast(ok ? `已打开并复制浏览器直通地址 ${url}（系统 Chrome / Edge 可正常弹出摄像头授权提示）` : `请手动在系统浏览器打开：${url}`, ok ? 'success' : 'info', { timeout: 9000 })
              }, { size: 'sm', icon: 'external' }),
              ui.btn('重试', () => startCam(), { size: 'sm', icon: 'retry', busyText: '请求中…' }),
            )
          : null,
      )
    }
    function paintVu(lvl) {
      T.vuFill.style.width = `${lvl}%`
      T.vuFill.classList.toggle('is-hot', lvl > 78)
      T.vuVal.textContent = `${lvl}%`
      T.vu.setAttribute('aria-valuenow', String(lvl))
      T.vuIcon.style.color = lvl > 8 ? 'var(--pk-ok)' : 'var(--pk-ink3)'
    }
    function stopMeter() {
      cancelAnimationFrame(T.vuRaf)
      T.vuRaf = 0
      try {
        if (T.ac) T.ac.close()
      } catch {}
      T.ac = null
      paintVu(0)
    }
    function startMeter(stream) {
      stopMeter()
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC || !stream.getAudioTracks().length) return
        const ac = new AC()
        T.ac = ac
        if (ac.resume) ac.resume().catch(() => {})
        const src = ac.createMediaStreamSource(stream)
        const an = ac.createAnalyser()
        an.fftSize = 256
        src.connect(an)
        const buf = new Uint8Array(an.frequencyBinCount)
        const tick = (now) => {
          if (!T.ac) return
          if (now - T.vuLast > 60) {
            T.vuLast = now
            an.getByteFrequencyData(buf)
            let sum = 0
            for (let i = 0; i < buf.length; i++) sum += buf[i]
            paintVu(Math.min(100, Math.round((sum / buf.length / 110) * 100)))
          }
          T.vuRaf = requestAnimationFrame(tick)
        }
        T.vuRaf = requestAnimationFrame(tick)
      } catch {}
    }
    function setAuto(on) {
      T.auto = Boolean(on)
      cancelAnimationFrame(T.raf)
      T.raf = 0
      if (T.auto) {
        T.pos = T.box.scrollTop
        let last = performance.now()
        const tick = (now) => {
          if (!T.auto) return
          const dt = Math.min(0.1, (now - last) / 1000)
          last = now
          if (T.box.isConnected) {
            const max = T.box.scrollHeight - T.box.clientHeight
            T.pos = Math.min(max, T.pos + dt * TELE.speed * 38)
            T.box.scrollTop = Math.round(T.pos)
          }
          T.raf = requestAnimationFrame(tick)
        }
        T.raf = requestAnimationFrame(tick)
      }
      if (T.autoBtnLbl && T.autoBtnLbl.isConnected) T.autoBtnLbl.textContent = T.auto ? '暂停滚词' : '测试滚词'
    }
    function resetScroll() {
      T.pos = 0
      T.box.scrollTop = 0
    }
    function friendlyCamError(err, deviceHint) {
      const name = String((err && err.name) || '')
      const msg = String((err && err.message) || err || '')
      if (/NotAllowed|Permission|Security/i.test(`${name} ${msg}`))
        return `摄像头与麦克风权限被拦截${deviceHint}：\n1) 如果浏览器弹出了权限提示，请点「允许」；\n2) Windows 请检查「设置 → 隐私和安全性 → 相机 / 麦克风 → 允许桌面应用访问」；\n3) 也可以点「在系统浏览器中打开自拍」用 Chrome / Edge 录制，或用「上传本机已录视频 / 音频入库」导入录好的片段。`
      if (/NotFound|DevicesNotFound|OverConstrained/i.test(name)) return `没有检测到可用的摄像头或麦克风${deviceHint}。请插好摄像头 / 麦克风后点「重试」，或直接上传本机已录好的视频。`
      if (/NotReadable|TrackStart|Abort/i.test(name)) return '摄像头或麦克风正被其他程序占用（例如会议软件、录屏软件）。请关闭占用它的程序后点「重试」。'
      if (/NotSupported|TypeError/i.test(name) || /not supported/i.test(msg))
        return `当前窗口不支持直接调起摄像头（浏览器或客户端内核限制）${deviceHint}。\n可以点「在系统浏览器中打开自拍」用 Chrome / Edge 录制，或用「上传本机已录视频 / 音频入库」导入手机、相机里录好的片段。`
      return `摄像头没有打开（原因：${msg || name || '未知'}）${deviceHint}。\n请确认摄像头已插好、没有被其他程序占用，然后点「重试」；也可以直接上传本机已录好的视频。`
    }
    async function startCam() {
      T.error = ''
      T.note = ''
      if (T.stream) return
      const md = navigator.mediaDevices
      if (!md || typeof md.getUserMedia !== 'function') {
        T.error = '当前窗口不支持直接调起摄像头（MediaDevices 不可用）。可以点「在系统浏览器中打开自拍」用 Chrome / Edge 录制，或用「上传本机已录视频 / 音频入库」导入录好的片段。'
        paintEmpty()
        ctx.update()
        return
      }
      T.starting = true
      paintEmpty()
      let deviceHint = ''
      try {
        if (md.enumerateDevices) {
          const devs = await md.enumerateDevices()
          const cams = devs.filter((d) => d.kind === 'videoinput').length
          const mics = devs.filter((d) => d.kind === 'audioinput').length
          if (!cams && !mics) deviceHint = '（未检测到任何摄像头或麦克风设备）'
        }
      } catch {}
      let stream = null
      let note = ''
      const errs = []
      const tries = [
        [{ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: { echoCancellation: true, noiseSuppression: true } }, ''],
        [{ video: true, audio: true }, ''],
        [{ video: true, audio: false }, '⚠ 只打开了摄像头画面（麦克风没有权限或不存在），录制的视频没有声音，之后可以搭配 AI 配音或克隆声纹。'],
        [{ video: false, audio: true }, '🎙 摄像头不可用（被权限拦截、被占用或不存在），已切换为纯麦克风录音模式（可用于配音 / 声纹克隆）。'],
      ]
      for (const [c, n] of tries) {
        try {
          stream = await md.getUserMedia(c)
          note = n
          break
        } catch (err) {
          errs.push(err)
        }
      }
      // the most actionable reason first: permission > device busy > no device > whatever came first
      const firstErr =
        errs.find((e) => /NotAllowed|Permission|Security/i.test(`${e && e.name} ${e && e.message}`)) ||
        errs.find((e) => /NotReadable|TrackStart|Abort/i.test(String(e && e.name))) ||
        errs.find((e) => /NotFound|DevicesNotFound|OverConstrained/i.test(String(e && e.name))) ||
        errs[0]
      T.starting = false
      if (ctx.frame.closed) {
        if (stream) stream.getTracks().forEach((t) => t.stop())
        return
      }
      if (!stream) {
        T.error = friendlyCamError(firstErr, deviceHint)
        paintEmpty()
        PK.toast(/权限/.test(T.error) ? '摄像头被系统或客户端权限拦截，已给出解决办法和上传替代方案' : '摄像头没有打开，已给出解决办法', 'warn')
        ctx.update()
        return
      }
      T.stream = stream
      T.note = note
      for (const tr of stream.getTracks()) tr.addEventListener('ended', () => onTrackEnded())
      if (stream.getVideoTracks().length) {
        T.video.srcObject = stream
        const pr = T.video.play()
        if (pr && typeof pr.catch === 'function') pr.catch(() => {})
      }
      startMeter(stream)
      paintEmpty()
      if (note) PK.toast(note, 'info', { timeout: 7000 })
      onTrackEnded() // a track can already be dead when getUserMedia resolves (its 'ended' event would never fire)
      ctx.update()
    }
    function onTrackEnded() {
      if (!T.stream) return
      if (!liveTracks().length) {
        if (T.rec && T.rec.state === 'recording') {
          try {
            T.rec.stop()
          } catch {}
        }
        stopCam(true)
        T.error = '摄像头连接中断了（可能被拔出或被其他程序占用），请点「重试」重新打开。'
        paintEmpty()
        ctx.update()
        return
      }
      if (T.stream.getVideoTracks().length && !T.hasLiveVideo() && !T.videoLost) {
        // the picture died but the microphone still works: say so instead of showing a frozen / black frame
        T.videoLost = true
        T.note = '⚠ 摄像头画面中断了（可能被拔出、被其他程序占用或驱动出错），现在只能录到声音。可以点「关闭摄像头」后重新开启。'
        try {
          T.video.pause()
        } catch {}
        T.video.srcObject = null
        PK.toast(T.note, 'warn', { timeout: 8000 })
        paintEmpty()
        ctx.update()
      }
    }
    function clearCountdown() {
      clearInterval(T.countTimer)
      T.countTimer = 0
      T.countN = 0
      T.count.hidden = true
    }
    function stopCam(silent) {
      clearCountdown()
      clearInterval(T.recTimer)
      T.recTimer = 0
      try {
        if (T.rec && T.rec.state !== 'inactive') {
          T.rec.__discard = true
          T.rec.stop()
        }
      } catch {}
      T.rec = null
      if (T.stream) {
        try {
          T.stream.getTracks().forEach((t) => t.stop())
        } catch {}
      }
      T.stream = null
      T.videoLost = false
      try {
        T.video.pause()
      } catch {}
      T.video.srcObject = null
      stopMeter()
      setAuto(false)
      T.vf.classList.remove('is-rec')
      T.recPill.hidden = true
      if (!silent) paintEmpty()
    }
    function beginRecording() {
      if (!T.stream) return
      const v = liveTracks('video')
      const a = liveTracks('audio')
      if (!v.length && !a.length) {
        PK.toast('摄像头和麦克风都已断开，请点「关闭摄像头」后重新开启再录制', 'error')
        return
      }
      const hasVideo = v.length > 0
      // never hand MediaRecorder a dead track (an ended camera would leave an empty video stream in the file)
      const src = v.length + a.length === T.stream.getTracks().length ? T.stream : new MediaStream([...v, ...a])
      const mime = pickRecMime(hasVideo)
      let mr
      try {
        mr = mime ? new MediaRecorder(src, { mimeType: mime }) : new MediaRecorder(src)
      } catch (err) {
        PK.toast(`无法开始录制：${(err && err.message) || err}`, 'error')
        return
      }
      T.chunks = []
      T.rec = mr
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) T.chunks.push(ev.data)
      }
      mr.onstop = () => {
        clearInterval(T.recTimer)
        T.recTimer = 0
        T.vf.classList.remove('is-rec')
        T.recPill.hidden = true
        setAuto(false)
        if (T.rec === mr) T.rec = null
        if (mr.__discard || ctx.frame.closed) {
          T.chunks = []
          return
        }
        const type = mr.mimeType || mime || (hasVideo ? 'video/webm' : 'audio/webm')
        const blob = new Blob(T.chunks, { type })
        T.chunks = []
        if (blob.size < 256) {
          PK.toast('这段录制是空的（可能时间太短），请再试一次', 'warn')
          ctx.update()
          return
        }
        setTake(blob, { sec: T.recSec, hasVideo })
        PK.toast('录制结束！请回看效果，满意再点「写入素材库」', 'info')
      }
      mr.onerror = (ev) => PK.toast(`录制出错：${(ev && ev.error && ev.error.message) || '未知错误'}`, 'error')
      try {
        mr.start(300)
      } catch (err) {
        T.rec = null
        PK.toast(`无法开始录制：${(err && err.message) || err}`, 'error')
        return
      }
      T.recSec = 0
      T.recStarted = Date.now()
      T.vf.classList.add('is-rec')
      T.recPill.hidden = false
      T.recPill.lastChild.textContent = 'REC 00:00'
      resetScroll()
      setAuto(true)
      T.recTimer = setInterval(() => {
        T.recSec = Math.round((Date.now() - T.recStarted) / 1000)
        T.recPill.lastChild.textContent = `REC ${U.fmtDur(T.recSec)}`
        if (T.stopLbl && T.stopLbl.isConnected) T.stopLbl.textContent = `停止录制（${T.recSec}s）`
      }, 1000)
      ctx.update()
    }
    function setTake(blob, o = {}) {
      dropTake()
      const isVideo = /^video\//.test(blob.type) || o.hasVideo
      const ext = /mp4/.test(blob.type) ? 'mp4' : /ogg/.test(blob.type) ? 'ogg' : 'webm'
      const base = TELE.role === 'avatar_base' ? 'avatar-base-cam' : isVideo ? 'host-cam' : 'host-voice'
      T.take = { blob, url: URL.createObjectURL(blob), fileName: o.fileName || `${base}-${Date.now()}.${ext}`, sec: num(o.sec), size: blob.size, isVideo }
      ctx.update()
      requestAnimationFrame(() => {
        const card = ctx.body.querySelector('.pk-ops-take')
        if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }
    function dropTake() {
      const url = T.take && T.take.url
      T.take = null
      // detach every preview of the take BEFORE its object URL dies (a still-loading element would log a failed blob fetch)
      dropVideo(ctx, 'take')
      for (const el of ctx.body.querySelectorAll('.pk-ops-take audio, .pk-ops-take video')) releaseMedia(el)
      if (url) setTimeout(() => URL.revokeObjectURL(url), 0)
    }
    function startCountdown() {
      if (!T.stream || typeof MediaRecorder === 'undefined') {
        PK.toast(typeof MediaRecorder === 'undefined' ? '当前窗口不支持录制（MediaRecorder 不可用），请改用上传本机录像' : '请先点击「开启摄像头与麦克风」', 'warn')
        return
      }
      if (T.take) dropTake()
      clearCountdown()
      T.countN = 3
      T.count.hidden = false
      T.count.firstChild.textContent = '3'
      T.countTimer = setInterval(() => {
        T.countN -= 1
        if (T.countN <= 0) {
          clearCountdown()
          beginRecording()
        } else T.count.firstChild.textContent = String(T.countN)
      }, 1000)
      ctx.update()
    }
    function stopRecording() {
      if (T.countTimer) {
        clearCountdown()
        ctx.update()
        return
      }
      if (T.rec && T.rec.state === 'recording') {
        try {
          T.rec.stop()
        } catch {}
      }
    }
    async function saveTake() {
      const take = T.take
      if (!take) return
      const dir = PK.needProject()
      const role = TELE.role
      ctx.busy(TELE.clone ? '📹 正在写入素材库并同步提取声纹（可能需要十几秒）…' : '📹 正在写入素材库（assets/recordings/）并测算精准时长…')
      try {
        const dataBase64 = await blobToBase64(take.blob)
        const d = await PK.post('assets/recording', { projectDir: dir, fileName: take.fileName, role, extractVoiceClone: Boolean(TELE.clone), dataBase64 }, { timeout: 900000 })
        if (role === 'avatar_base' && d && d.relPath) {
          try {
            await PK.action('setAvatar', { patch: { enabled: true, mode: 'cloned-human', sourcePath: d.relPath } })
          } catch (err) {
            PK.reportError(err, '已入库，但设置数字人底板失败')
          }
        }
        if (T.take === take) dropTake()
        PK.store.invalidate()
        // browser WebM recordings carry no duration header, so the server probe may say 0 — fall back to the REC timer
        const measured = num(d && d.durationSec)
        const secTxt = measured > 0 ? `${measured.toFixed(1)} 秒` : take.sec ? `约 ${take.sec} 秒` : ''
        PK.toast(`已保存出镜录像${secTxt ? `（${secTxt}）` : ''}${d && d.clonedVoice ? ` · 已同步提取声纹「${d.clonedVoice.name}」` : ''}${role === 'avatar_base' ? ' · 已设为克隆数字人底板' : ''}`, 'success', {
          action: role === 'avatar_base' ? { label: '打开数字人设置', onClick: () => PK.open('avatar') } : { label: '查看素材库', onClick: () => PK.open('studio', { step: 'assets' }) },
        })
        if (TELE.clone && !(d && d.clonedVoice))
          PK.toast('录像已入库，但这次没能提取出你的声纹（录音可能太短、太安静或没有声音）。可以重录一条，或到「配音中心」用录音克隆声音。', 'warn', {
            action: { label: '打开配音中心', onClick: () => PK.open('voices') },
            timeout: 9000,
          })
        T.lastSaved = { ...(d || {}), secTxt }
        ctx.update()
        return d
      } finally {
        ctx.busy(false)
      }
    }
    async function importLocal() {
      PK.needProject()
      const files = await PK.pickFiles({ accept: 'video/*,audio/*,.mp4,.mov,.webm,.mkv,.wav,.mp3,.m4a', multiple: true })
      if (!files.length) return
      const n = await PK.importFiles(files, { role: TELE.role || 'host_video' })
      PK.toast(`已导入 ${n || files.length} 个文件，入库角色：${(TELE_ROLES.find((r) => r.value === TELE.role) || TELE_ROLES[0]).label}`, 'success')
    }
    T.applyStyle = applyStyle
    T.paintEmpty = paintEmpty
    T.startCam = startCam
    T.stopCam = stopCam
    T.startCountdown = startCountdown
    T.stopRecording = stopRecording
    T.saveTake = saveTake
    T.dropTake = dropTake
    T.setTake = setTake
    T.setAuto = setAuto
    T.resetScroll = resetScroll
    T.importLocal = importLocal
    T.recording = () => Boolean(T.rec && T.rec.state === 'recording')
    T.dispose = () => {
      stopCam(true)
      dropTake()
      cancelAnimationFrame(T.raf)
    }
    applyStyle()
    paintEmpty()
    paintVu(0)
    L.T = T
    return T
  }

  function teleStage(T) {
    const overlay = TELE.layout === 'overlay' && T.stream && T.hasLiveVideo()
    if (overlay) {
      if (T.pwrap.parentNode !== T.vf) T.vf.insertBefore(T.pwrap, T.recPill)
      return h('div.pk-ops-stage.is-solo', null, T.vf)
    }
    return h('div.pk-ops-stage', null, T.vf, T.pwrap)
  }

  async function teleGenerate(ctx) {
    const T = ctx.local.T
    const dir = PK.needProject()
    const s = st()
    const d0 = curDirector()
    const store = await PK.store.load().catch(() => null)
    const script = (store && store.activeProject && store.activeProject.script) || {}
    const topic = String(d0.topic || script.displayTitle || script.title || (s.project && s.project.title) || '品牌与产品实战介绍').trim()
    const tone = PK.optionLabel('styles', d0.style, d0.style || 'tech')
    const prev = TELE.text
    const d = await PK.post('teleprompter/generate', { projectDir: dir, topic, durationSec: TELE.durationSec, tone }, { timeout: 120000 })
    const text = String((d && (d.text || (d.lines || []).join('\n\n'))) || '').trim()
    if (!text) throw new PK.Error('AI 没有返回提词稿，请稍后再试')
    TELE.text = text
    T.applyStyle()
    T.resetScroll()
    ctx.render()
    const local = d && d.model === 'local-script-template'
    PK.toast(local ? '还没有配置大模型：已用分镜旁白 / 本地模板生成提词稿' : `口播提词稿已更新（${(d && d.model) || 'AI'}），点「3 秒倒数开拍」即自动滚词`, 'success', {
      action: prev && prev !== text ? { label: '撤销', onClick: () => ((TELE.text = prev), T.applyStyle(), ctx.render()) } : null,
      timeout: 8000,
    })
  }

  PK.panel('teleprompter', {
    title: '提词器录制',
    en: 'TELEPROMPTER · 真人出镜 / 数字人底板拍摄棚',
    idx: 'TP',
    icon: 'cam',
    kind: 'modal',
    size: 'xl',
    group: 'tools',
    order: 45,
    desc: '边看提词边录口播，3-2-1 倒数开拍，回看满意再入库',
    needsProject: true,
    aliases: { prompter: {}, tele: {}, camera: {}, webcam: {}, recorder: {} },
    watch: (s) => [s && s.project && s.project.dir],
    onWatch(ctx) {
      if (!PK.hasProject()) {
        ctx.local.forceClose = true
        ctx.close()
        return
      }
      ctx.update()
    },
    mount(ctx) {
      const L = ctx.local
      if (!TELE.text) {
        TELE.text = TELE_DEFAULT_TEXT
        PK.store
          .load()
          .then((d) => {
            const scenes = (d && d.activeProject && d.activeProject.script && d.activeProject.script.scenes) || []
            const lines = scenes.map((x) => String((x && x.narration) || '').trim()).filter(Boolean)
            if (lines.length && TELE.text === TELE_DEFAULT_TEXT) {
              TELE.text = lines.join('\n\n')
              if (L.T) L.T.applyStyle()
              ctx.update()
            }
          })
          .catch(() => {})
      }
      teleController(ctx)
      ctx.onCleanup(() => L.T && L.T.dispose())
    },
    beforeClose(ctx, reason) {
      const L = ctx.local
      const T = L.T
      if (L.forceClose || reason === 'force' || !T) return true
      const recording = T.recording() || Boolean(T.countTimer)
      if (!recording && !T.take) return true
      PK.confirm({
        title: recording ? '正在录制，确定关闭？' : '这条录像还没写入素材库',
        text: recording ? '关闭会中止录制，本次录制的内容不会保存。' : '关闭后这条录像会被丢弃。要保存的话，请先点「满意，写入素材库」。',
        ok: '丢弃并关闭',
        danger: true,
      }).then((ok) => {
        if (!ok) return
        L.forceClose = true
        ctx.close()
      })
      return false
    },
    unmount(ctx) {
      if (ctx.local.T) ctx.local.T.dispose()
      releaseAllMedia(ctx)
    },
    render(ctx) {
      const L = ctx.local
      const T = teleController(ctx)
      T.applyStyle()
      const streaming = Boolean(T.stream)
      const recording = T.recording()
      const counting = Boolean(T.countTimer)
      const roleOpt = TELE_ROLES.find((r) => r.value === TELE.role) || TELE_ROLES[0]
      // footer: the main camera / recording actions are always visible
      let main = []
      if (!streaming)
        main = [
          ui.btn('上传本机录像入库', () => T.importLocal(), { icon: 'upload', busyText: '上传中…', title: '已经用手机或相机录好了？直接导入素材库' }),
          ui.btn(T.starting ? '正在打开…' : '开启摄像头与麦克风', () => T.startCam(), { kind: 'primary', icon: 'cam', busyText: '请求权限中…', disabled: T.starting }),
        ]
      else if (counting) main = [ui.btn('取消倒计时', () => T.stopRecording(), { kind: 'danger', icon: 'x' })]
      else if (recording) {
        const b = ui.btn(`停止录制（${T.recSec}s）`, () => T.stopRecording(), { kind: 'danger', icon: 'stop' })
        T.stopLbl = b.querySelector('.pk-btn-l')
        main = [b]
      } else
        main = [
          ui.btn('关闭摄像头', () => {
            T.stopCam()
            ctx.render()
          }, { icon: 'x', kind: 'ghost' }),
          ui.btn('3 秒倒数开拍并滚词', () => T.startCountdown(), { kind: 'primary', icon: 'cam', disabled: typeof MediaRecorder === 'undefined', title: typeof MediaRecorder === 'undefined' ? '当前窗口不支持录制，请改用上传本机录像' : '倒数 3 秒后开始录制，提词板同时自动滚动' }),
        ]
      const autoBtn = ui.btn(T.auto ? '暂停滚词' : '测试滚词', () => T.setAuto(!T.auto), { icon: 'arrowR', kind: 'ghost', disabled: recording, title: '让提词板按当前速度自动滚动（双击提词板也可以开 / 停）' })
      T.autoBtnLbl = autoBtn.querySelector('.pk-btn-l')
      ctx.foot([ui.hint(`入库角色：${roleOpt.label}${TELE.clone ? ' · 同步克隆声纹' : ''}`), ui.spacer(), autoBtn, ...main])

      const take = T.take
      let takeCard = null
      if (take) {
        const tv = take.isVideo
          ? keepVideo(ctx, 'take', take.url, (el) => {
              el.controls = true
              el.preload = 'auto'
            })
          : (dropVideo(ctx, 'take'), h('audio.pk-audio', { src: take.url, controls: 'controls', preload: 'metadata' }))
        takeCard = h(
          'div.pk-ops-take',
          { key: 'tele-take' },
          h('b', null, take.isVideo ? '🎬 刚拍好一段出镜视频，请回看确认是否入库：' : '🎙 刚录好一段口播音频，请回听确认是否入库：'),
          tv,
          h('p.pk-ops-sub', null, `时长约 ${take.sec || 0} 秒 · ${U.fmtBytes(take.size)} · 入库角色：${roleOpt.label}${TELE.clone ? ' · 会同步提取你的声纹' : ''}`),
          ui.row([
            ui.btn('满意，写入素材库', () => T.saveTake(), { kind: 'primary', icon: 'check', busyText: '写入中…' }),
            ui.btn('作废并重拍', async () => {
              const ok = await PK.confirm({ title: '作废这条录像？', text: '这条录像还没保存，作废后无法找回。', ok: '作废', danger: true })
              if (!ok) return
              T.dropTake()
              PK.toast('已作废刚才那条，准备好就可以重新拍摄', 'info')
              ctx.render()
            }, { kind: 'danger', icon: 'trash' }),
          ]),
        )
      } else dropVideo(ctx, 'take')

      const scriptEditor = ui.section(
        {
          title: '提词稿',
          en: 'SCRIPT',
          icon: 'prompt',
          actions: [
            ui.btn('用分镜旁白填充', async () => {
              const d = await PK.store.load()
              const scenes = (d && d.activeProject && d.activeProject.script && d.activeProject.script.scenes) || []
              const lines = scenes.map((x) => String((x && x.narration) || '').trim()).filter(Boolean)
              if (!lines.length) throw new PK.Error('当前工程的分镜里还没有旁白，可以先用 AI 生成提词稿')
              const prev = TELE.text
              TELE.text = lines.join('\n\n')
              T.applyStyle()
              T.resetScroll()
              ctx.render()
              PK.toast(`已填入 ${lines.length} 段分镜旁白`, 'success', { action: prev && prev !== TELE.text ? { label: '撤销', onClick: () => ((TELE.text = prev), T.applyStyle(), ctx.render()) } : null })
            }, { size: 'sm', icon: 'film', busyText: '读取中…' }),
          ],
        },
        ui.row([
          ui.btn('AI 生成提词稿', () => teleGenerate(ctx), { kind: 'primary', icon: 'wand', busyText: 'AI 撰写中…', title: '按创意需求和视觉风格撰写可直接朗读的口播稿' }),
          h('span.pk-ops-sub', null, '时长'),
          ui.seg({ value: String(TELE.durationSec), options: [30, 45, 60, 90].map((x) => ({ value: String(x), label: `${x} 秒` })), onChange: (v) => (TELE.durationSec = Number(v) || 45) }),
        ]),
        ui.textarea({
          key: 'tele-text',
          value: TELE.text,
          rows: 6,
          minRows: 5,
          maxRows: 14,
          counter: true,
          placeholder: '在这里粘贴或输入要朗读的口播台词，也可以让 AI 帮你写…',
          onInput: (v) => {
            TELE.text = v
            T.textEl.textContent = v
          },
          expand: { title: '提词稿 · 大号编辑', hint: '每句 12~24 字、按句换行，录制时更容易看清。' },
        }),
      )
      const settings = ui.section(
        { title: '拍摄设置', en: 'SETTINGS', icon: 'settings' },
        h(
          'div.pk-ops-sliders',
          null,
          ui.field({ label: '滚词速度', en: 'SPEED' }, ui.slider({ value: TELE.speed, min: 0.3, max: 3, step: 0.1, format: (v) => `${Number(v).toFixed(1)}×`, onInput: (v) => (TELE.speed = v), onChange: (v) => (TELE.speed = v) })),
          ui.field({ label: '字体大小', en: 'FONT' }, ui.slider({ value: TELE.font, min: 18, max: 42, step: 1, format: (v) => `${v}px`, onInput: (v) => ((TELE.font = v), T.applyStyle()) })),
          ui.field({ label: '行距', en: 'LINE' }, ui.slider({ value: TELE.lh, min: 1.2, max: 2.2, step: 0.05, format: (v) => Number(v).toFixed(2), onInput: (v) => ((TELE.lh = v), T.applyStyle()) })),
          ui.field({ label: '词板深浅', en: 'BACKDROP' }, ui.slider({ value: TELE.opacity, min: 0.15, max: 0.9, step: 0.05, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ((TELE.opacity = v), T.applyStyle()) })),
        ),
        ui.field(
          { label: '提词板位置', en: 'LAYOUT' },
          ui.seg({
            value: TELE.layout,
            options: [
              { value: 'side', label: '画面旁独立提词栏' },
              { value: 'overlay', label: '叠加在画面上方', hint: '眼神更贴近镜头（开启摄像头后生效）' },
            ],
            onChange: (v) => {
              TELE.layout = v
              ctx.render()
            },
          }),
        ),
        ui.toggle({ value: TELE.mirrorCam, label: '自拍画面左右镜像', hint: '只影响预览，像照镜子一样更自然；录下来的视频是正向的', onChange: (v) => ((TELE.mirrorCam = v), T.applyStyle()) }),
        ui.toggle({ value: TELE.mirrorText, label: '提词文字镜像', hint: '配合分光镜 / 提词器硬件使用', onChange: (v) => ((TELE.mirrorText = v), T.applyStyle()) }),
        ui.toggle({ value: TELE.clone, label: '同步克隆我的声纹', hint: '入库时从录音里提取你的声音，之后配音可以用「你自己的声音」', onChange: (v) => ((TELE.clone = v), ctx.render()) }),
        ui.field({ label: '录像入库角色', en: 'ROLE' }, ui.select({ value: TELE.role, options: TELE_ROLES, showHint: true, onChange: (v) => ((TELE.role = v), ctx.render()) })),
      )
      return [
        T.note && streaming ? ui.note(T.note, { level: 'warn' }) : null,
        teleStage(T),
        streaming ? T.vu : null,
        takeCard,
        T.lastSaved && !take ? ui.note(`上一条已保存到 ${T.lastSaved.relPath || 'assets/recordings/'}${T.lastSaved.secTxt ? `（${T.lastSaved.secTxt}）` : ''}${T.lastSaved.clonedVoice ? ` · 声纹「${T.lastSaved.clonedVoice.name}」已加入音色库` : ''}`, { level: 'ok', title: '已写入素材库' }) : null,
        ui.split(scriptEditor, settings, { ratio: 'minmax(0, 1.15fr) minmax(0, 1fr)' }),
      ]
    },
  })
})()
