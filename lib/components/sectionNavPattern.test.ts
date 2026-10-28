import fs from 'fs'
import path from 'path'

// A section's pages are switched with the shared `SectionNavDropdown`, at every
// width, and nowhere else. Settings, Account & security and Admin once had a
// sticky navigation rail beside the content from `lg` up (and a "Back to …"
// row below it), in a wider `--container-section` column; a second list of a
// section's pages beside the app sidebar made every page read as two columns
// of navigation. The rail, the Back row and the wide column were removed on
// purpose (see "Page Header & Sub-Navigation" in docs/architecture.md).
//
// This is a text scan of the source, with no rendering and no app imports, so
// it cannot be flaky. It fails on the tokens a reintroduction needs.

const SOURCE_ROOTS = ['app', 'lib']

const walk = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(entryPath)
    return [entryPath]
  })

const isTest = (file: string) => /\.test\.tsx?$/.test(file)

const sourceFiles = SOURCE_ROOTS.flatMap((root) =>
  walk(path.join(process.cwd(), root))
).filter((file) => /\.(tsx?|css)$/.test(file) && !isTest(file))

const relative = (file: string) => path.relative(process.cwd(), file)
// Compares whole path segments, so `lib/components-old` is not "under"
// `lib/components`.
const isUnder = (file: string, ...directory: string[]) => {
  const segments = relative(file).split(path.sep)
  return directory.every((segment, index) => segments[index] === segment)
}
const read = (file: string) => fs.readFileSync(file, 'utf8')

const lineOf = (text: string, index: number) =>
  text.slice(0, index).split('\n').length

const findAll = (files: string[], pattern: RegExp) =>
  files.flatMap((file) => {
    const text = read(file)
    return [...text.matchAll(pattern)].map(
      (match) =>
        `${relative(file)}:${lineOf(text, match.index ?? 0)} — ${match[0]}`
    )
  })

// Every `app/(timeline)/**/layout.tsx`: where a section would put a navigation
// list beside its content.
const timelineLayouts = sourceFiles.filter(
  (file) =>
    path.basename(file) === 'layout.tsx' && isUnder(file, 'app', '(timeline)')
)

describe('section navigation pattern', () => {
  it('scans real sources (a bad root would pass vacuously)', () => {
    expect(sourceFiles.length).toBeGreaterThan(50)
    expect(timelineLayouts.length).toBeGreaterThan(5)
  })

  it('has no trace of the wide section column', () => {
    expect(
      findAll(
        sourceFiles,
        /data-section-layout|max-w-section|--container-section/g
      )
    ).toEqual([])
  })

  it('exports no section rail', () => {
    const components = sourceFiles.filter((file) =>
      isUnder(file, 'lib', 'components')
    )
    expect(
      findAll(components, /export (?:const|function) SectionNav\b/g)
    ).toEqual([])
  })

  it('renders no navigation list or Back row in a (timeline) layout', () => {
    const offenders = [
      // A navigation list beside the content: a sticky or lg-only <nav>.
      ...findAll(
        timelineLayouts,
        /<nav\b[^>]*(?:max-lg:hidden|sticky)[^>]*>/gs
      ),
      // A "Back to <section>" row, built from the section's name or written out.
      ...findAll(timelineLayouts, /<BackLink\b[^>]*label=\{`Back to \$\{/gs),
      ...findAll(
        timelineLayouts,
        /"Back to (?:Settings|Admin|Account & security)"/g
      ),
      // A grouped list of links beside the content.
      ...findAll(timelineLayouts, /role="group"/g)
    ]
    expect(offenders).toEqual([])
  })

  it('has every section switch pages with the shared dropdown', () => {
    const importsOf = (layout: string) =>
      read(path.join(process.cwd(), 'app', '(timeline)', layout))

    for (const layout of [
      'fitness/layout.tsx',
      'gallery/layout.tsx',
      'fitness/connections/layout.tsx'
    ]) {
      expect(importsOf(layout), layout).toMatch(
        /from '@\/lib\/components\/section-nav-dropdown'/
      )
    }
    for (const layout of [
      'settings/layout.tsx',
      'account/layout.tsx',
      'admin/layout.tsx'
    ]) {
      expect(importsOf(layout), layout).toMatch(
        /import \{[^}]*\bSectionLayout\b[^}]*\} from '@\/lib\/components\/section-nav'/
      )
    }
  })
})
