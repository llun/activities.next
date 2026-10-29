// Cut each doc into heading-aligned line ranges of at most ~LIMIT bytes (hard-split long sections).
import { readFileSync } from 'node:fs'
const LIMIT = 40000
const files = process.argv.slice(2)
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  let start = 1, bytes = 0
  const out = []
  lines.forEach((l, i) => {
    const n = i + 1
    const isHead = /^#{2,4} /.test(l)
    if (n > start && (bytes + l.length > LIMIT) && (isHead || bytes > LIMIT * 1.25)) {
      out.push([start, n - 1]); start = n; bytes = 0
    }
    bytes += l.length + 1
  })
  out.push([start, lines.length])
  for (const [a, b] of out) console.log(`${f}\t${a}\t${b}`)
}
