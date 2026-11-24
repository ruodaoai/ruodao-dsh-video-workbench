// Rebuild the production skin from port/src/: head + style (css/*.css sorted, else 1-style.css) + body + script(js/*.js sorted) + tail.
// Syntax-checks the script with `node --check` on a temp copy (parse only, nothing executes).
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..')
const target = join(root, 'packages/dsh-web-video-workbench/lib/warroom/prism-lab.html')
const src = join(here, 'src'), jsDir = join(src, 'js'), cssDir = join(src, 'css')
const rd = (f) => readFileSync(join(src, f), 'utf8')
const files = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort()
const js = "'use strict';\n(() => {\n" + files.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('') + '})();\n'
const cssFiles = existsSync(cssDir) ? readdirSync(cssDir).filter((f) => f.endsWith('.css')).sort() : []
const css = cssFiles.length ? cssFiles.map((f) => readFileSync(join(cssDir, f), 'utf8')).join('') : rd('1-style.css')
const tmp = mkdtempSync(join(tmpdir(), 'prism-build-'))
const tf = join(tmp, 'skin.js')
writeFileSync(tf, js)
const chk = spawnSync(process.execPath, ['--check', tf], { encoding: 'utf8' })
rmSync(tmp, { recursive: true, force: true })
if (chk.status !== 0) { console.error('SYNTAX ERROR\n' + chk.stderr); process.exit(1) }
const out = rd('0-head.html') + css + rd('2-body.html') + js + rd('9-tail.html')
const hard = out.match(/\beval\s*\(|new Function\s*\(|\bfetch\s*\(|XMLHttpRequest|\bimportScripts\b|\bWebSocket\s*\(/)
if (hard) { console.error('FORBIDDEN TOKEN: ' + hard[0]); process.exit(1) }
const urls = out.match(/https?:\/\/(?!www\.w3\.org)[^\s"'`)<]*/g)
if (urls) console.warn('WARN url literals:', [...new Set(urls)].join(' '))
const small = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((m) => +m[1] < 12)
if (cssFiles.length && small.length) console.warn('WARN css font-size < 12px:', small.map((m) => m[0]).join(' '))
writeFileSync(target, out)
console.log('built', target.slice(root.length), out.length, 'bytes', (out.length / 1024).toFixed(1) + ' KB', files.length, 'js parts', cssFiles.length || 1, 'css parts')
