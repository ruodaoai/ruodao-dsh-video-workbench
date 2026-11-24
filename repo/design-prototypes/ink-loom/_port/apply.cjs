// Patch applier for the INK LOOM skin port.
// Usage: node apply.cjs <patch.txt> [--dry]
// Patch DSL (directive lines start with "@@@ "; everything else is verbatim content):
//   @@@ REPLACE            <old>  @@@ WITH <new>  @@@ END      old must occur exactly once
//   @@@ REPLACE_ALL        <old>  @@@ WITH <new>  @@@ END      old must occur >= 1 times
//   @@@ RANGE <start> @@@ TO <end> @@@ WITH <new> @@@ END      replaces start..end inclusive (both unique, end after start)
//   @@@ INSERT_BEFORE <anchor> @@@ TEXT <new> @@@ END          anchor unique
//   @@@ INSERT_AFTER  <anchor> @@@ TEXT <new> @@@ END          anchor unique
// All blocks are applied in memory; nothing is written if any block fails. File is normalised to LF.
'use strict'
const fs = require('fs')
const path = require('path')
const TARGET = path.resolve(__dirname, '../../../packages/dsh-web-video-workbench/lib/warroom/ink-loom.html')
const patchFile = process.argv[2]
const dry = process.argv.includes('--dry')
if (!patchFile) { console.error('usage: node apply.cjs <patch.txt> [--dry]'); process.exit(2) }
const raw = fs.readFileSync(patchFile, 'utf8').replace(/\r\n/g, '\n')
const lines = raw.split('\n')
const blocks = []
let cur = null, sect = null
for (const ln of lines) {
  const m = /^@@@ ([A-Z_]+)\s*$/.exec(ln)
  if (m) {
    const d = m[1]
    if (['REPLACE', 'REPLACE_ALL', 'RANGE', 'INSERT_BEFORE', 'INSERT_AFTER'].includes(d)) {
      if (cur) throw new Error('nested block start ' + d)
      cur = { kind: d, parts: { a: [], b: [], c: [] } }; sect = 'a'; continue
    }
    if (!cur) throw new Error('directive outside block: ' + d)
    if (d === 'WITH') { sect = cur.kind === 'RANGE' ? 'c' : 'b'; continue }
    if (d === 'TO') { sect = 'b'; continue }
    if (d === 'TEXT') { sect = 'b'; continue }
    if (d === 'END') { blocks.push(cur); cur = null; sect = null; continue }
    throw new Error('unknown directive ' + d)
  }
  if (cur) cur.parts[sect].push(ln)
}
if (cur) throw new Error('unterminated block')
let src = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')
const count = (hay, needle) => { let n = 0, i = 0; if (!needle) return 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length } return n }
const errs = []
blocks.forEach((b, k) => {
  const A = b.parts.a.join('\n'), B = b.parts.b.join('\n'), C = b.parts.c.join('\n')
  const tag = `#${k + 1} ${b.kind} «${A.slice(0, 70).replace(/\n/g, '⏎')}»`
  if (b.kind === 'REPLACE') {
    const n = count(src, A); if (n !== 1) { errs.push(`${tag}: found ${n}x`); return }
    src = src.replace(A, () => B)
  } else if (b.kind === 'REPLACE_ALL') {
    const n = count(src, A); if (n < 1) { errs.push(`${tag}: found 0x`); return }
    src = src.split(A).join(B)
  } else if (b.kind === 'RANGE') {
    const n1 = count(src, A); if (n1 !== 1) { errs.push(`${tag}: start found ${n1}x`); return }
    const i0 = src.indexOf(A)
    const i1 = src.indexOf(B, i0 + A.length)
    if (i1 < 0) { errs.push(`${tag}: end «${B.slice(0, 50)}» not found after start`); return }
    const n2 = count(src.slice(i0 + A.length), B); if (n2 < 1) { errs.push(`${tag}: end missing`); return }
    src = src.slice(0, i0) + C + src.slice(i1 + B.length)
  } else {
    const n = count(src, A); if (n !== 1) { errs.push(`${tag}: anchor found ${n}x`); return }
    const i = src.indexOf(A)
    src = b.kind === 'INSERT_BEFORE' ? src.slice(0, i) + B + '\n' + src.slice(i) : src.slice(0, i + A.length) + '\n' + B + src.slice(i + A.length)
  }
})
if (errs.length) { console.error('PATCH FAILED (nothing written):\n  ' + errs.join('\n  ')); process.exit(1) }
if (dry) { console.log(`dry run ok: ${blocks.length} block(s)`); process.exit(0) }
const bakDir = path.join(__dirname, 'bak')
fs.mkdirSync(bakDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
fs.copyFileSync(TARGET, path.join(bakDir, `ink-loom.${stamp}.${path.basename(patchFile, '.txt')}.html`))
fs.writeFileSync(TARGET, src)
console.log(`applied ${blocks.length} block(s) from ${path.basename(patchFile)} -> ${src.length} chars, ${Buffer.byteLength(src)} bytes`)
