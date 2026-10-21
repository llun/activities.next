import { parseSync } from '@swc/core'
import fs from 'fs'
import path from 'path'

// Every `Alert` is the standalone card in the page or section stack, beside
// the boxes and never inside one (see **Surfaces** in docs/architecture.md).
// This parses each `.tsx` of `app/` and `lib/` and fails on an `<Alert` nested
// in a `<Frame>` or `<FramedList>` of the same file, so a message moved back
// into its box is caught wherever it is. An Alert in an `AuthCard` is not
// seen: the card is another component, and the page's surface.
const ROOT = process.cwd()
const BOX_TAGS = new Set(['Frame', 'FramedList'])

// The Messages chat panes are the page's surface: their Alerts are the pane's
// own rows, so they stay inside the `Frame`.
const ALLOWED_FILES = new Set([
  path.normalize('app/(timeline)/messages/MessagesPage.tsx')
])

const collectTsx = (dir: string): string[] =>
  fs
    .readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '.next'
          ? []
          : collectTsx(relative)
      }
      return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)
        ? [relative]
        : []
    })

type Span = { start: number }
type Node = { type?: string; span?: Span; [key: string]: unknown }

// The 1-based line of every `<Alert` that sits inside a box in `source`.
const alertsInBoxes = (source: string): number[] => {
  const program = parseSync(source, { syntax: 'typescript', tsx: true })
  const lines: number[] = []
  const walk = (value: unknown, inBox: boolean) => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, inBox))
    if (!value || typeof value !== 'object') return
    const node = value as Node
    const tagName = (element: unknown) =>
      ((element as Node).name as { value?: string } | undefined)?.value
    let nextInBox = inBox
    if (node.type === 'JSXOpeningElement' && inBox) {
      if (tagName(node) === 'Alert') {
        // swc spans carry a running offset across parses: make them file-relative.
        const offset = node.span!.start - (program.span.start as number)
        lines.push(source.slice(0, offset).split('\n').length)
      }
    }
    if (node.type === 'JSXElement') {
      const name = tagName(node.opening)
      if (name && BOX_TAGS.has(name)) nextInBox = true
    }
    for (const child of Object.values(node)) walk(child, nextInBox)
  }
  walk(program.body, false)
  return lines
}

describe('Alert outside Frame', () => {
  it('finds an Alert in a Frame or FramedList, and only there', () => {
    const inFrame =
      'const A = () => (\n  <Frame form footer={<SaveBar />}>\n    <Alert title="x" />\n  </Frame>\n)'
    expect(alertsInBoxes(inFrame)).toEqual([3])
    expect(
      alertsInBoxes('const A = () => <FramedList><Alert /></FramedList>')
    ).toEqual([1])
    expect(
      alertsInBoxes(
        'const A = () => <><Alert title="x" /><Frame form>{ok}</Frame></>'
      )
    ).toEqual([])
  })

  it('keeps every Alert out of its Frame', () => {
    const inBox = ['app', 'lib']
      .flatMap(collectTsx)
      .filter((file) => !ALLOWED_FILES.has(path.normalize(file)))
      .flatMap((file) => {
        const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
        return source.includes('<Alert')
          ? alertsInBoxes(source).map((line) => `${file}:${line}`)
          : []
      })
    expect(inBox).toEqual([])
  })

  it('still needs its allowed file to hold an Alert in a Frame', () => {
    for (const file of ALLOWED_FILES) {
      const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
      expect(alertsInBoxes(source).length).toBeGreaterThan(0)
    }
  })
})
