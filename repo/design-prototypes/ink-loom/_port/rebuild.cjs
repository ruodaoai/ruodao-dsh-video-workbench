// Rebuild ink-loom.html from its sources: the base snapshot (state after 01..34 + the coordinator's kit wiring, saved by
// apply.cjs as the backup taken right before 35 was applied) + every patch _port/NN-*.txt with NN >= 35, in name order.
// Same patch DSL as apply.cjs (REPLACE / REPLACE_ALL / RANGE / INSERT_BEFORE / INSERT_AFTER, markers must be unique).
// All patches are applied in memory; nothing is written if one fails. The previous target is backed up to bak/.
// usage: node rebuild.cjs [--verify]   (--verify: only report whether the rebuilt file equals the current target)
'use strict'
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const PORT = __dirname
const TARGET = path.resolve(PORT, '../../../packages/dsh-web-video-workbench/lib/warroom/ink-loom.html')
const BASE = path.join(PORT, 'bak', 'ink-loom.2026-11-21T15-26-26-149Z.35-kit-wire.html')
const verify = process.argv.includes('--verify')
const chain = fs.readdirSync(PORT).filter((f) => /^(\d+)[a-z]?-.*\.txt$/.test(f) && parseInt(f, 10) >= 35).sort()

function parse(raw) {
  const blocks = []
  let cur = null, sect = null
  for (const ln of raw.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^@@@ ([A-Z_]+)\s*$/.exec(ln)
    if (m) {
      const d = m[1]
      if (['REPLACE', 'REPLACE_ALL', 'RANGE', 'INSERT_BEFORE', 'INSERT_AFTER'].includes(d)) {
        if (cur) throw new Error('nested block start ' + d)
        cur = { kind: d, parts: { a: [], b: [], c: [] } }; sect = 'a'; continue
      }
      if (!cur) throw new Error('directive outside block: ' + d)
      if (d === 'WITH') { sect = cur.kind === 'RANGE' ? 'c' : 'b'; continue }
      if (d === 'TO' || d === 'TEXT') { sect = 'b'; continue }
      if (d === 'END') { blocks.push(cur); cur = null; sect = null; continue }
      throw new Error('unknown directive ' + d)
    }
    if (cur) cur.parts[sect].push(ln)
  }
  if (cur) throw new Error('unterminated block')
  return blocks
}
const count = (hay, needle) => { let n = 0, i = 0; if (!needle) return 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length } return n }
function applyBlocks(src, blocks, errs, file) {
  blocks.forEach((b, k) => {
    const A = b.parts.a.join('\n'), B = b.parts.b.join('\n'), C = b.parts.c.join('\n')
    const tag = `${file} #${k + 1} ${b.kind} «${A.slice(0, 60).replace(/\n/g, '⏎')}»`
    if (b.kind === 'REPLACE') {
      const n = count(src, A); if (n !== 1) { errs.push(`${tag}: found ${n}x`); return }
      src = src.replace(A, () => B)
    } else if (b.kind === 'REPLACE_ALL') {
      if (count(src, A) < 1) { errs.push(`${tag}: found 0x`); return }
      src = src.split(A).join(B)
    } else if (b.kind === 'RANGE') {
      const n1 = count(src, A); if (n1 !== 1) { errs.push(`${tag}: start found ${n1}x`); return }
      const i0 = src.indexOf(A), i1 = src.indexOf(B, i0 + A.length)
      if (i1 < 0) { errs.push(`${tag}: end «${B.slice(0, 50)}» not found after start`); return }
      src = src.slice(0, i0) + C + src.slice(i1 + B.length)
    } else {
      const n = count(src, A); if (n !== 1) { errs.push(`${tag}: anchor found ${n}x`); return }
      const i = src.indexOf(A)
      src = b.kind === 'INSERT_BEFORE' ? src.slice(0, i) + B + '\n' + src.slice(i) : src.slice(0, i + A.length) + '\n' + B + src.slice(i + A.length)
    }
  })
  return src
}

let src = fs.readFileSync(BASE, 'utf8').replace(/\r\n/g, '\n')
const errs = []
for (const f of chain) {
  let blocks
  try { blocks = parse(fs.readFileSync(path.join(PORT, f), 'utf8')) } catch (e) { errs.push(`${f}: ${e.message}`); continue }
  src = applyBlocks(src, blocks, errs, f)
}
if (errs.length) { console.error('REBUILD FAILED (nothing written):\n  ' + errs.join('\n  ')); process.exit(1) }
const cur = fs.readFileSync(TARGET, 'utf8').replace(/\r\n/g, '\n')
if (verify) { console.log(`chain ${chain.join(' ')} -> ${Buffer.byteLength(src)} bytes; ${src === cur ? 'IDENTICAL to' : 'DIFFERS from'} current target (${Buffer.byteLength(cur)} bytes)`); process.exit(0) }
if (src === cur) console.log(`chain ${chain.join(' ')}: target already up to date (${Buffer.byteLength(src)} bytes)`)
else {
  fs.mkdirSync(path.join(PORT, 'bak'), { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  fs.copyFileSync(TARGET, path.join(PORT, 'bak', `ink-loom.${stamp}.rebuild-${chain[chain.length - 1].replace(/\.txt$/, '')}.html`))
  fs.writeFileSync(TARGET, src)
  console.log(`rebuilt from base + ${chain.length} patch(es) [${chain.join(' ')}] -> ${Buffer.byteLength(src)} bytes`)
}
const r = spawnSync(process.execPath, [path.join(PORT, 'check.cjs')], { encoding: 'utf8' })
process.stdout.write(r.stdout.split('\n').slice(-4).join('\n'))
process.exit(r.status || 0)
