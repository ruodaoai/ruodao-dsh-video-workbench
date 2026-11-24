/**
 * @dsh-video/tool-media — photosensitivity budget for full-screen flashes (WCAG 2.x / ITU-R BT.1702 / Harding).
 *
 * The render QA fails a film when any 1-second window holds more than 3 flashes (a ≥ 20 % luminance swing on ≥ 25 % of
 * the frame and back). Both engines can draw several kinds of full-screen flash — flash-cut transitions, light wipes,
 * the white frame of a weapon clash, keyframed camera flashes, the accent wash at the end of a shot, beat strobes — and
 * an action sequence can stack them several times a second. They are therefore scheduled once, up front, from the
 * script alone (every frame stays deterministic in any render order):
 *   - candidates are kept by priority (heavier / more meaningful flashes first, then earlier ones);
 *   - any two kept flashes start at least `minGapSec` apart (0.5 s → at most 2 per second);
 *   - no 1-second window holds more than `maxStepsPerWindow` luminance steps: a flash that overlaps the window counts
 *     2 (up and down), a hard cut no kept flash already covers counts 1 — 7 steps can never form the 4 flash pairs the
 *     QA fails on, even when cuts between bright and dark shots join in.
 * Dropped flashes are drawn in a non-flashing form by the engines (flash-cut → zoom-punch, no white frame, no strobe);
 * the clash sound, sparks, blade arcs and camera shake stay on every hit.
 *
 * Self-contained (no imports, plain JavaScript): the Remotion project gets a verbatim copy as `src/lib/flash-budget.ts`.
 */

export const FLASH_MIN_GAP_SEC = 0.5
export const FLASH_MAX_STEPS_PER_WINDOW = 7

/**
 * @param {{
 *   fps?: number,
 *   candidates?: Array<{ key: string, frame: number, lead?: number, len?: number, prio?: number, coversCut?: number|null }>,
 *   cutFrames?: number[],
 *   minGapSec?: number,
 *   maxStepsPerWindow?: number,
 * }} input  `frame` = the flash's peak frame (the minimum gap is measured between peaks), `lead` / `len` = frames it
 *           ramps up before the peak / lasts from the peak, `coversCut` = the hard cut it lands on (that cut's own
 *           luminance step is part of the flash)
 * @returns {{ dropped: Record<string, boolean>, kept: string[], gapFrames: number, windowFrames: number }}
 */
export function scheduleFlashBudget(input) {
  const opts = input || {}
  const fps = Math.max(1, Number(opts.fps) || 30)
  const minGapSec = Number(opts.minGapSec) > 0 ? Number(opts.minGapSec) : FLASH_MIN_GAP_SEC
  const gap = Math.max(1, Math.round(minGapSec * fps))
  const win = Math.max(1, Math.round(fps))
  const maxSteps = Number(opts.maxStepsPerWindow) > 0 ? Number(opts.maxStepsPerWindow) : FLASH_MAX_STEPS_PER_WINDOW
  const rawCands = Array.isArray(opts.candidates) ? opts.candidates : []
  const cutsRaw = Array.isArray(opts.cutFrames) ? opts.cutFrames : []

  const cuts = []
  for (let i = 0; i < cutsRaw.length; i++) {
    const c = Math.round(Number(cutsRaw[i]))
    if (Number.isFinite(c)) cuts.push(c)
  }
  const cands = []
  for (let i = 0; i < rawCands.length; i++) {
    const c = rawCands[i] || {}
    const frame = Math.round(Number(c.frame))
    if (!Number.isFinite(frame) || c.key === undefined || c.key === null) continue
    const cover = Math.round(Number(c.coversCut))
    const coversCut = c.coversCut === null || c.coversCut === undefined || !Number.isFinite(cover) ? null : cover
    let start = frame - Math.max(0, Math.round(Number(c.lead) || 0))
    let end = frame + Math.max(1, Math.round(Number(c.len) || 3))
    // the covered cut is part of the flash: its span always includes it (a window holding the cut holds the flash)
    if (coversCut !== null) {
      start = Math.min(start, coversCut)
      end = Math.max(end, coversCut + 1)
    }
    // `peak` (the frame as supplied) is what the minimum gap is measured on; `frame..frame+len` is the whole span
    cands.push({ key: String(c.key), peak: frame, frame: start, len: end - start, prio: Number(c.prio) || 0, coversCut, order: i })
  }
  cands.sort(function (a, b) {
    return b.prio - a.prio || a.peak - b.peak || a.order - b.order
  })

  const kept = []
  const keptSpans = []
  const covered = {}
  const dropped = {}
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i]
    let ok = true
    for (let k = 0; k < keptSpans.length; k++) {
      if (Math.abs(keptSpans[k].peak - c.peak) < gap) {
        ok = false
        break
      }
    }
    // every 1-second window that overlaps this flash must stay within the luminance-step budget
    for (let w = c.frame - win + 1; ok && w <= c.frame + c.len - 1; w++) {
      const wEnd = w + win
      let steps = 2
      for (let k = 0; k < keptSpans.length; k++) {
        const s = keptSpans[k]
        if (s.frame < wEnd && s.frame + s.len > w) steps += 2
      }
      for (let k = 0; k < cuts.length; k++) {
        const cut = cuts[k]
        if (cut >= w && cut < wEnd && !covered[cut] && cut !== c.coversCut) steps += 1
      }
      if (steps > maxSteps) ok = false
    }
    if (ok) {
      kept.push(c.key)
      keptSpans.push({ peak: c.peak, frame: c.frame, len: c.len })
      if (c.coversCut !== null) covered[c.coversCut] = true
    } else {
      dropped[c.key] = true
    }
  }
  return { dropped, kept, gapFrames: gap, windowFrames: win }
}
