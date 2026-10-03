import fs from 'fs'
import path from 'path'

// Every native select and checkbox in the app is the shared primitive:
//
// - `Select` is the closed control with the design's muted chevron, the 36 px
//   height and the focus ring. A raw `<select className={cn('…',
//   selectChevronClassName)}>` was the hand-rolled copy it replaced — it
//   drifted (a 1 px focus ring, a 34 px height, no shadow) until it sat visibly
//   next to the real one.
// - `Checkbox` is the 16 px, radius-4 box with the orange fill and white tick.
//   A bare `<input type="checkbox">` shows the browser's own blue control, which
//   the mute dialog did until it was converted.
//
// One raw `<select>` is deliberate: the activity-file switcher on the fitness
// status page overlays its own foreground-coloured `ChevronDown`, as the
// design draws it, so it is not the muted-chevron control.
//
// Each file is paired with how many raw `<select>`s it may hold: the status
// page is 2,200 lines, and a bare file name would let a second one in.
const RAW_SELECT_ALLOWED = new Map([
  ['lib/components/ui/select.tsx', 1],
  ['app/(timeline)/[actor]/[status]/FitnessStatusDetail.tsx', 1]
])
const RAW_CHECKBOX_ALLOWED = new Set(['lib/components/ui/checkbox.tsx'])

const SOURCE_ROOTS = ['app', 'lib']

const collectSourceFiles = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(entryPath)
    if (!/\.tsx$/.test(entry.name)) return []
    if (/\.test\.tsx$/.test(entry.name)) return []
    return [entryPath]
  })

const sourceFiles = () =>
  SOURCE_ROOTS.flatMap((root) =>
    collectSourceFiles(path.join(process.cwd(), root))
  )

const relative = (file: string) => path.relative(process.cwd(), file)

// Several files explain in a comment why a menu is not a `<select>`, so match
// the element in code, not in prose.
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

const codeOf = (file: string) => withoutComments(fs.readFileSync(file, 'utf8'))

const RAW_SELECT_TAG = /<select[\s>]/
const rawSelectCount = (file: string) =>
  [...codeOf(file).matchAll(new RegExp(RAW_SELECT_TAG, 'g'))].length
const RAW_CHECKBOX_TAG = /<input\b[^>]*\btype=["']checkbox["']/

describe('Form control usage', () => {
  it('has source files to scan', () => {
    // Guard against the walker silently finding nothing (a bad root, a moved
    // directory) and the assertions below passing vacuously.
    expect(sourceFiles().length).toBeGreaterThan(100)
  })

  it('uses the shared Select instead of a raw <select>', () => {
    const offenders = sourceFiles()
      .filter((file) => !RAW_SELECT_ALLOWED.has(relative(file)))
      .filter((file) => RAW_SELECT_TAG.test(codeOf(file)))
      .map(relative)

    expect(offenders).toEqual([])
  })

  it('keeps the select allow-list exact', () => {
    // An entry with no raw <select> left would silently let the next one in,
    // and one holding more than the case it excuses is a second one let in, so
    // each file must contain exactly its count.
    const counts = Object.fromEntries(
      [...RAW_SELECT_ALLOWED.keys()].map((file) => [
        file,
        rawSelectCount(path.join(process.cwd(), file))
      ])
    )
    expect(counts).toEqual(Object.fromEntries(RAW_SELECT_ALLOWED))
  })

  it('uses the shared Checkbox instead of a raw <input type="checkbox">', () => {
    const offenders = sourceFiles()
      .filter((file) => !RAW_CHECKBOX_ALLOWED.has(relative(file)))
      .filter((file) => RAW_CHECKBOX_TAG.test(codeOf(file)))
      .map(relative)

    expect(offenders).toEqual([])
  })
})
