import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const css = readFileSync(
  fileURLToPath(new URL('../app/globals.css', import.meta.url)),
  'utf8'
)

/** Body span of the `{ ... }` opening at `open`, by brace matching. */
const bodyEnd = (open: number): number => {
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) return i
  }
  throw new Error('unterminated block')
}

/** The `@supports` block that holds `.feed-row`, as [start, open, end]. */
const supportsSpan = (): [number, number, number] => {
  let from = 0
  for (;;) {
    const start = css.indexOf('@supports', from)
    expect(start).toBeGreaterThanOrEqual(0)
    const open = css.indexOf('{', start)
    const end = bodyEnd(open)
    if (css.slice(open, end).includes('.feed-row')) return [start, open, end]
    from = end
  }
}

const supportsCondition = () => {
  const [start, open] = supportsSpan()
  return css.slice(start, open).replace(/\s+/g, ' ')
}
const supportsBlock = () => {
  const [, open, end] = supportsSpan()
  return css.slice(open + 1, end).replace(/\s+/g, ' ')
}

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(p)
    return /\.tsx$/.test(entry.name) ? [p] : []
  })

describe('feed-row content-visibility', () => {
  it('skips off-screen rows only where :has() and scroll anchoring exist', () => {
    const condition = supportsCondition()
    expect(condition).toContain('selector(:has(a))')
    expect(condition).toContain('(overflow-anchor: auto)')
    expect(supportsBlock()).toMatch(
      /\.feed-row \{[^}]*content-visibility: auto;[^}]*contain-intrinsic-block-size: auto 380px;/
    )
  })

  it('turns containment off for a row holding an open overlay', () => {
    expect(supportsBlock()).toMatch(
      /\.feed-row:has\(\[data-row-overlay\]\) \{[^}]*content-visibility: visible;/
    )
  })

  it('has no selector mentioning feed-row outside the @supports block', () => {
    const [start, , end] = supportsSpan()
    const outside = css.slice(0, start) + css.slice(end + 1)
    const withoutComments = outside.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(withoutComments).not.toContain('.feed-row')
  })

  it('has no ungated Tailwind content-visibility class in components', () => {
    const offenders = ['lib', 'app']
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .filter((file) =>
        /\[content-visibility:/.test(readFileSync(file, 'utf8'))
      )
    expect(offenders).toEqual([])
  })
})
