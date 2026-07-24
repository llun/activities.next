import fs from 'fs'
import path from 'path'

// Tailwind v3 let an arbitrary value hold a bare custom property —
// `w-[--radix-popper-anchor-width]` compiled to `width: var(--radix-…)`.
// Tailwind v4 removed that shorthand in favour of parentheses,
// `w-(--radix-…)`, and now compiles the bracket form literally, to
// `width: --radix-…`. That is not a valid declaration, so the browser drops
// it and the utility silently does nothing.
//
// The failure has no error and no build warning: the element simply falls
// back to its default sizing. It shipped in two components at once — both
// section-nav dropdown menus rendered narrower than their own trigger,
// sized to their content, for as long as the class was there. Nothing but
// a human eye on the rendered page could catch it.
//
// This project is on Tailwind v4, so the bracket-with-bare-variable form is
// always a bug. `[var(--x)]` is untouched — that stays valid in v4 — as are
// arbitrary variants like `[&_svg]` and arbitrary values that merely contain
// a variable, e.g. `[calc(var(--x)-1px)]`.
const BARE_CSS_VARIABLE_IN_BRACKETS = /\[--[a-zA-Z][\w-]*\]/g

const SOURCE_ROOTS = ['app', 'lib']

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    if (!/\.tsx?$/.test(entry.name)) return []
    if (/\.test\.tsx?$/.test(entry.name)) return []
    return [entryPath]
  })

describe('Tailwind CSS variable syntax', () => {
  it('uses the v4 parenthesis form, never the removed v3 bracket form', () => {
    const files = SOURCE_ROOTS.flatMap((root) =>
      collectSourceFiles(path.join(process.cwd(), root))
    )
    // Guard against the walker silently finding nothing (a bad root, a moved
    // directory) and the assertion passing vacuously.
    expect(files.length).toBeGreaterThan(100)

    const offenders = files.flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          [...line.matchAll(BARE_CSS_VARIABLE_IN_BRACKETS)].map(([match]) => {
            const fixed = `(${match.slice(1, -1)})`
            const relative = path.relative(process.cwd(), file)
            return `${relative}:${index + 1} — ${match} should be ${fixed}`
          })
        )
    )

    expect(offenders).toEqual([])
  })
})
