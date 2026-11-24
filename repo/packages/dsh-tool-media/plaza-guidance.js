/**
 * @dsh-video/tool-media — the 影核广场 (Template Plaza) style recipe inside a project's director notes.
 *
 * Applying a template appends its style recipe to `script.directorNotes` between the markers below. The recipe was
 * written for the template's source film (its duration, shot count, people and events), so code that reads the user's
 * own wording — the duration hint parser, the brief key points of the fallback storyboard — strips the block first:
 * numbers and events of the source film must never leak into the new subject.
 */

export const PLAZA_GUIDANCE_END = '【/影核广场模板】'

/** The block appended to director notes when a template is applied (style only — the content follows the new topic). */
export function buildPlazaGuidanceBlock(templateName, recipe) {
  const name = String(templateName || '模板').trim()
  return [
    `【影核广场模板 · ${name} · 风格复刻：只复刻画风、配色、转场、节奏与字幕样式；人物、事件、地点、时长与镜头数一律以本工程的主题为准，不沿用模板原片的内容】`,
    String(recipe || '').trim(),
    PLAZA_GUIDANCE_END,
  ].join('\n')
}

/** Remove every template style-recipe block (current markers and the pre-v0.6.0 one-paragraph form) from a text. */
export function stripPlazaTemplateGuidance(text) {
  let s = String(text || '')
  if (!s.includes('影核广场模板')) return s
  // current form: start marker … end marker
  s = s.replace(/【影核广场模板 ·[^】]*】[\s\S]*?【\/影核广场模板】/g, '\n')
  // pre-v0.6.0 form: 【影核广场模板复刻指导 · NAME】 + the recipe paragraph on the next line
  s = s.replace(/【影核广场模板复刻指导[^】]*】[^\n]*(?:\n[^\n【]*)?/g, '\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}
