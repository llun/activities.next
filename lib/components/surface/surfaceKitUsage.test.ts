import fs from 'fs'
import path from 'path'

// The surface kit (`lib/components/surface/`) is the one set of page
// primitives: Section, Frame, FormRow, SaveBar, StatStrip, FramedList,
// TableFrame, EmptyState, Alert, SegmentedControl and the Skeleton helpers.
// Pages that predate it hand-roll the same things, and every hand-rolled copy
// is a place the app looks different from the next page over.
//
// This guard counts three hand-rolled patterns across the `.tsx` and `.ts`
// files of `app/` and `lib/` (tests and the kit itself excluded; comments are
// stripped first, so prose that quotes a class name or "Loading…" is not
// counted) and fails when ANY of them appears: the migration to the kit is
// finished, so all three counts are zero and a new copy is a regression.
//
// One thing is allowed to be a fixed colour: data. A chart series, a heatmap
// ramp or a category chip encodes WHICH thing it is, so it is the same in
// light and dark and cannot come from a theme token (a token says "error" or
// "success", never "this is the heart-rate line"). Those palettes live in one
// named module per domain, and `DATA_PALETTE_FILES` below lists exactly those
// files, each with its reason. The guard skips them, nothing else, and fails
// if a listed file no longer holds a raw colour (a stale entry) or does not
// exist. To say success, warning, info or an error, use `Alert`, `Badge` or the
// `success` / `warning` / `info` / `destructive` tokens instead; do not add to
// this list for a colour that means one of those.
const DATA_PALETTE_FILES: Record<string, string> = {
  'lib/components/fitness/palette.ts':
    'Fitness chart series colours (elevation, speed, power, heart rate): each series keeps its own fixed colour in both themes so the line, crosshair dot and legend chip match.'
}

// The one other fixed colour: a badge fill the design gives as a hex in dark
// mode, which no token carries. Only the arbitrary hex in those files is
// skipped: a palette utility (`bg-green-100`) in them still counts. Checked for
// staleness the same way; not a place for new colours.
const DESIGN_HEX_FILES: Record<string, string> = {
  'lib/components/ui/badge.tsx':
    'The Badge tones: the design gives the dark-mode fills (grey, primary and destructive tints) as fixed hex values that no token carries.',
  'lib/components/notification-badge/NotificationBadge.tsx':
    'The unread-count dot: the design gives its light-mode red as a fixed hex (#B7282E) that the destructive fill token does not match.'
}

const FIXED_COLOUR_FILES: Record<string, string> = {
  ...DATA_PALETTE_FILES,
  ...DESIGN_HEX_FILES
}

const ROOT = process.cwd()
const SCANNED_DIRS = ['app', 'lib']
const KIT_DIR = path.join('lib', 'components', 'surface')

const DATA_PALETTE_PATHS = new Set(
  Object.keys(DATA_PALETTE_FILES).map((file) => path.normalize(file))
)
const DESIGN_HEX_PATHS = new Set(
  Object.keys(DESIGN_HEX_FILES).map((file) => path.normalize(file))
)

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
// Every Tailwind palette family followed by a shade, on any colour utility
// (`text-`, `bg-`, `border-l-`, `ring-offset-`, `fill-`, `from-`...). The
// neutrals count too: `text-neutral-400` skips dark mode just as `text-red-500`
// does. `white` and `black` carry no shade and are not counted. The same
// utilities set to an arbitrary hex (`bg-[#ff0000]`) or to the palette
// variable (`text-(--color-red-500)`, `text-[var(--color-red-500)]`) are the
// same thing written differently and count too.
const PALETTE =
  'slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const COLOUR_UTILITY =
  '\\b(?:bg|text|border(?:-[xytblrse])?|ring(?:-offset)?|fill|stroke|from|via|to|outline|divide|decoration|accent|caret|shadow|placeholder)-'
const PALETTE_FORMS = `(?:${PALETTE})-\\d|\\[var\\(--color-(?:${PALETTE})-\\d|\\((?:color:)?--color-(?:${PALETTE})-\\d`
const RAW_COLOUR = new RegExp(`${COLOUR_UTILITY}(?:${PALETTE_FORMS}|\\[#)`, 'g')
// The same without the arbitrary hex. The `DESIGN_HEX_FILES` are skipped for
// hex only; a palette utility in them still counts.
const RAW_COLOUR_NO_HEX = new RegExp(
  `${COLOUR_UTILITY}(?:${PALETTE_FORMS})`,
  'g'
)
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

const read = (file: string) =>
  stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'))

const measure = () => {
  const found = { sectionPanels: 0, rawColours: 0, loadingText: 0 }
  for (const file of SCANNED_DIRS.flatMap(collectSources)) {
    const source = read(file)
    for (const literal of source.match(STRING_LITERAL) ?? []) {
      if (/\brounded-2xl\b/.test(literal) && /\bshadow-sm\b/.test(literal)) {
        found.sectionPanels += 1
      }
    }
    const normalized = path.normalize(file)
    if (DATA_PALETTE_PATHS.has(normalized)) {
      // Skipped whole: this module IS the data palette.
    } else if (DESIGN_HEX_PATHS.has(normalized)) {
      found.rawColours += count(source, RAW_COLOUR_NO_HEX)
    } else {
      found.rawColours += count(source, RAW_COLOUR)
    }
    found.loadingText +=
      count(source, LOADING_JSX_TEXT) + count(source, LOADING_STRING)
  }
  return found
}

const found = measure()

describe('surface kit usage', () => {
  it('has no shadowed rounded-2xl section panel', () => {
    expect(
      found.sectionPanels,
      'A `rounded-2xl ... shadow-sm` panel is the old card. Lay the section out with `Section` for the heading and `Frame` (with `FormRow`s and a `SaveBar`, or `FramedList`) for the content from `@/lib/components/surface`: flat `rounded-lg border`, no shadow.'
    ).toBe(0)
  })

  it('has no raw palette colour utility outside the data palettes', () => {
    expect(
      found.rawColours,
      'Raw colour utilities (`text-green-600`, `bg-yellow-50`, `text-neutral-400`, ...) skip dark mode and the contrast checks. Say success, warning, info or an error with `Alert` (`tone`) or `Badge`, or use the theme tokens (`text-success-text`, `text-warning-text`, `text-info-text`, `text-destructive-text`, `bg-primary/10`, `text-muted-foreground`) from `app/globals.css`. A fixed colour that encodes data (a chart series) goes in a named palette module listed in DATA_PALETTE_FILES, with a reason.'
    ).toBe(0)
  })

  it('has no "Loading…" text', () => {
    expect(
      found.loadingText,
      'Do not write "Loading…" on screen. Draw the final layout with `SkeletonBar` / `SkeletonRows` from `@/lib/components/surface` (a `loading.tsx` for a route), and keep a spinner for inside a button only. Screen readers still get an `sr-only` "Loading".'
    ).toBe(0)
  })

  it('lists only existing fixed-colour files that still hold a raw colour', () => {
    for (const [file, reason] of Object.entries(FIXED_COLOUR_FILES)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(20)
      expect(
        fs.existsSync(path.join(ROOT, file)),
        `${file} is on the fixed-colour list but does not exist; remove it`
      ).toBe(true)
      expect(
        count(read(file), RAW_COLOUR),
        `${file} is on the fixed-colour list but holds no raw colour; remove it`
      ).toBeGreaterThan(0)
    }
  })

  it('skips only the hex in a design-hex file, not a palette utility', () => {
    const badge = "tone: 'bg-[#2A2A2A] text-[#F5F5F5] dark:bg-[#3A1D1D]'"
    expect(count(badge, RAW_COLOUR_NO_HEX)).toBe(0)
    expect(count(badge, RAW_COLOUR)).toBe(3)
    expect(
      count(
        "tone: 'bg-[#2A2A2A] bg-green-100 text-green-800'",
        RAW_COLOUR_NO_HEX
      )
    ).toBe(2)
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
    // The neutral families, side-specific borders, ring offsets, gradient stops
    // and opacity suffixes count too; white, black and theme tokens do not.
    expect(
      count(
        'text-neutral-400 border-l-amber-500 ring-offset-slate-900 from-sky-400/20 dark:fill-zinc-300',
        RAW_COLOUR
      )
    ).toBe(5)
    expect(
      count('bg-white text-black border-border bg-muted/40', RAW_COLOUR)
    ).toBe(0)
    // The newer neutral families, arbitrary hex values and the palette
    // variables count; a theme variable does not.
    expect(
      count(
        'text-mauve-500 bg-olive-200 border-mist-300 fill-taupe-400',
        RAW_COLOUR
      )
    ).toBe(4)
    expect(
      count(
        'bg-[#ff0000] dark:stroke-[#f00] text-(--color-red-500) text-(color:--color-sky-400) text-[var(--color-green-600)]',
        RAW_COLOUR
      )
    ).toBe(5)
    expect(
      count(
        'bg-[var(--surface-chrome)] text-(--link-color) bg-[length:8px]',
        RAW_COLOUR
      )
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
