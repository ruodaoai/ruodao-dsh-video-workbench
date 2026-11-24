// Assemble the production skin from fragments.
// Usage (worktree root): node design-prototypes/nova-deck/src/build.mjs
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const SRC = 'design-prototypes/nova-deck/src'
const OUT = 'packages/dsh-web-video-workbench/lib/warroom/nova-deck.html'
const rd = (p) => readFileSync(join(SRC, p), 'utf8').replace(/\r\n/g, '\n')
const dir = (d, ext) => readdirSync(join(SRC, d)).filter((f) => f.endsWith(ext)).sort()

const cssFiles = dir('css', '.css')
const jsFiles = dir('js', '.js')
const css = cssFiles.map((f) => `/* ---- ${f} ---- */\n` + rd('css/' + f).trimEnd()).join('\n')
const js = jsFiles.map((f) => `/* ---- ${f} ---- */\n` + rd('js/' + f).trimEnd()).join('\n')
const html =
  rd('head.html').trimEnd() + '\n<style>\n' + css + '\n</style>\n</head>\n<body>\n' + rd('body.html').trimEnd() +
  // shared native panel kit (lib/warroom/kit.js, served next to the skin) loads before the skin script
  '\n<script src="kit.js"></script>' +
  "\n<script>\n'use strict';\n" + js + '\n</script>\n</body>\n</html>\n'

// syntax check of the assembled script
const tmp = mkdtempSync(join(tmpdir(), 'nd-build-'))
const tf = join(tmp, 'skin.js')
writeFileSync(tf, "'use strict';\n" + js)
const chk = spawnSync(process.execPath, ['--check', tf], { encoding: 'utf8' })
rmSync(tmp, { recursive: true, force: true })
if (chk.status !== 0) {
  console.error('[build] SYNTAX ERROR\n' + (chk.stderr || chk.stdout))
  // map line number back to a fragment
  const m = /skin\.js:(\d+)/.exec(chk.stderr || '')
  if (m) {
    let ln = Number(m[1]) - 1
    for (const f of jsFiles) {
      const n = (`/* ---- ${f} ---- */\n` + rd('js/' + f).trimEnd()).split('\n').length
      if (ln <= n) { console.error(`[build] -> ${f} line ~${ln - 1}`); break }
      ln -= n
    }
  }
  process.exit(1)
}
// forbidden tokens (rule 1: no network / eval)
const bad = []
for (const [re, why] of [[/\bfetch\s*\(/, 'fetch('], [/XMLHttpRequest/, 'XHR'], [/\beval\s*\(/, 'eval('], [/new\s+Function\s*\(/, 'new Function'], [/https?:\/\//, 'absolute URL'], [/@import/, '@import'], [/WebSocket/, 'WebSocket']]) {
  if (re.test(js) || (why === 'absolute URL' || why === '@import' ? re.test(css) : false)) bad.push(why)
}
writeFileSync(OUT, html)
const kb = (Buffer.byteLength(html) / 1024).toFixed(1)
console.log(`[build] ok -> ${OUT}  ${kb} KB  (css ${cssFiles.length} files, js ${jsFiles.length} files)` + (bad.length ? `  WARN forbidden: ${bad.join(', ')}` : ''))
