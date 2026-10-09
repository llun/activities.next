import fs from 'fs'
import path from 'path'

// The surface kit (`lib/components/surface/`) is the one set of page
// primitives: Section, Frame, FormRow, SaveBar, StatStrip, FramedList,
// TableFrame, EmptyState, Alert, SegmentedControl and the Skeleton helpers.
// Pages that predate it hand-roll the same things, and every hand-rolled copy
// is a place the app looks different from the next page over.
//
// This guard is a ratchet. It counts three hand-rolled patterns across the
// `.tsx` and `.ts` files of `app/` and `lib/` (tests and the kit itself
// excluded; comments are stripped first, so prose that quotes a class name or
// "Loading…" is not counted) and fails when a count goes ABOVE its baseline, so
// no new copy can be added. The
// baselines are the counts after the kit landed; each later migration PR lowers
// them to what it left, and the last one sets them to zero. When you remove a
// copy, lower the number here in the same change.
const BASELINE = {
  /** A string literal carrying both `rounded-2xl` and `shadow-sm`. */
  sectionPanels: 12,
  /** Raw Tailwind palette colour utilities. */
  rawColours: 114,
  /** "Loading…" / "Loading..." as JSX text or a bare string. */
  loadingText: 4
}

const ROOT = process.cwd()
const SCANNED_DIRS = ['app', 'lib']
const KIT_DIR = path.join('lib', 'components', 'surface')

const collectSources = (dir: string): string[] =>
  fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || relative === KIT_DIR
          ? []
          : collectSources(relative)
      }
      return /\.tsx?$/.test(entry.name) &&
        !/\.(?:test|d)\.tsx?$/.test(entry.name)
        ? [relative]
        : []
    })

// Every quoted string in the file ('...', "..." and `...`), which is where
// className values live whether they sit in an attribute or in `cn(...)`.
const STRING_LITERAL =
  /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g
const RAW_COLOUR =
  /\b(?:bg|text|border|ring|fill|stroke)-(?:red|green|amber|yellow|blue|emerald|orange|sky|rose)-\d/g
const LOADING = '(?:Loading…|Loading\\.\\.\\.)'
// JSX text (`>Loading…<`, or on a line of its own) and a bare string
// (`'Loading…'`). A longer sentence that merely starts with "Loading" in a
// string, such as an aria-label, is not what this is after.
const LOADING_JSX_TEXT = new RegExp(
  `>\\s*${LOADING}[^<>{}]*<|^\\s*${LOADING}\\s*$`,
  'gm'
)
const LOADING_STRING = new RegExp(`(['"\`])${LOADING}\\1`, 'g')

// Comments are prose, not UI: `{/* ... */}`, `/* ... */` and `// ...` (a `//`
// only counts as a comment at the start of a line or after whitespace, so the
// `//` in a URL string survives).
const stripComments = (source: string) =>
  source
    .replace(/(^|[\s{])\/\*[\s\S]*?\*\//g, '$1')
    .replace(/(^|\s)\/\/.*$/gm, '$1')

const count = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length

const measure = () => {
  const found = { sectionPanels: 0, rawColours: 0, loadingText: 0 }
  for (const file of SCANNED_DIRS.flatMap(collectSources)) {
    const source = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    for (const literal of source.match(STRING_LITERAL) ?? []) {
      if (/\brounded-2xl\b/.test(literal) && /\bshadow-sm\b/.test(literal)) {
        found.sectionPanels += 1
      }
    }
    found.rawColours += count(source, RAW_COLOUR)
    found.loadingText +=
      count(source, LOADING_JSX_TEXT) + count(source, LOADING_STRING)
  }
  return found
}

const found = measure()

describe('surface kit usage', () => {
  it('adds no new shadowed rounded-2xl section panel', () => {
    expect(
      found.sectionPanels,
      'A `rounded-2xl ... shadow-sm` panel is the old card. Lay the section out with `Section` for the heading and `Frame` (with `FormRow`s and a `SaveBar`, or `FramedList`) for the content from `@/lib/components/surface`: flat `rounded-lg border`, no shadow.'
    ).toBeLessThanOrEqual(BASELINE.sectionPanels)
  })

  it('adds no new raw palette colour utility', () => {
    expect(
      found.rawColours,
      'Raw colour utilities (`text-green-600`, `bg-yellow-50`, ...) skip dark mode and the contrast checks. Say success, warning, info or an error with `Alert` (`tone`), or use the theme tokens (`text-success-text`, `text-warning-text`, `text-info-text`, `text-destructive-text`, `bg-primary/10`) from `app/globals.css`.'
    ).toBeLessThanOrEqual(BASELINE.rawColours)
  })

  it('adds no new "Loading…" text', () => {
    expect(
      found.loadingText,
      'Do not write "Loading…" on screen. Draw the final layout with `SkeletonBar` / `SkeletonRows` from `@/lib/components/surface` (a `loading.tsx` for a route), and keep a spinner for inside a button only. Screen readers still get an `sr-only` "Loading".'
    ).toBeLessThanOrEqual(BASELINE.loadingText)
  })

  it('does not count prose in comments', () => {
    const commented = [
      '// <p className="text-green-600">Loading…</p>',
      '/* "rounded-2xl shadow-sm" and text-red-500 */',
      '{/* Loading... */}',
      '/**\n * text-amber-600 Loading…\n */',
      'const url = "https://example.com/x" // text-blue-500'
    ].join('\n')
    const stripped = stripComments(commented)
    expect(count(stripped, RAW_COLOUR)).toBe(0)
    expect(count(stripped, LOADING_JSX_TEXT)).toBe(0)
    expect(stripped).toContain('https://example.com/x')
  })

  it('recognises the patterns it counts', () => {
    expect(
      count('<p className="text-green-600 dark:bg-red-950">', RAW_COLOUR)
    ).toBe(2)
    expect(
      count('<p className="text-success-text bg-primary/10">', RAW_COLOUR)
    ).toBe(0)
    expect(count('<p>Loading…</p>', LOADING_JSX_TEXT)).toBe(1)
    expect(count('<p>\n  Loading...\n</p>', LOADING_JSX_TEXT)).toBe(1)
    expect(
      count("const label = loading ? 'Loading…' : 'Done'", LOADING_STRING)
    ).toBe(1)
    expect(count("aria-label='Loading photos'", LOADING_STRING)).toBe(0)
    expect(
      ('"rounded-2xl border shadow-sm p-6"'.match(STRING_LITERAL) ?? []).length
    ).toBe(1)
  })
})
