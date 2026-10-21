import { parseSync } from '@swc/core'
import fs from 'fs'
import path from 'path'

import { collectSourceFiles } from '@/lib/testing/moduleImports'

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

type Span = { start: number }
type Node = { type?: string; span?: Span; [key: string]: unknown }

// swc offsets are UTF-8 bytes on a counter that runs across every parse, and a
// module's span starts at its first token, after any leading comment. Parsing
// `;${source}` pins the span start to the first byte; the line is counted in
// bytes from there (same approach as `transactionCallSites.test.ts`).
const lineOfOffset = (source: string, offset: number) =>
  Buffer.from(source, 'utf8')
    .subarray(0, Math.max(0, offset))
    .toString('utf8')
    .split('\n').length

// The 1-based line of every `<Alert` that sits inside a box in `source`.
const alertsInBoxes = (source: string): number[] => {
  const program = parseSync(`;${source}`, { syntax: 'typescript', tsx: true })
  const base = (program.span.start as number) + 1
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
        lines.push(lineOfOffset(source, node.span!.start - base))
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

  it('reports the line after a leading comment and non-ASCII text', () => {
    const source =
      '// é — header\n\nconst A = () => (\n  <Frame>\n    <p>日本語</p>\n    <Alert title="é" />\n  </Frame>\n)'
    expect(alertsInBoxes(source)).toEqual([6])
  })

  it('counts lines in UTF-8 bytes when non-ASCII text precedes the Alert', () => {
    const source =
      '// 日本語日本語日本語日本語\n\nconst A = () => (\n  <Frame>\n    <p>日本語日本語</p>\n    <Alert />\n  </Frame>\n)'
    expect(alertsInBoxes(source)).toEqual([6])
  })

  it('keeps every Alert out of its Frame', () => {
    const files = ['app', 'lib']
      .flatMap(collectSourceFiles)
      .filter((file) => file.endsWith('.tsx'))
    // A dropped root would leave the scan green over nothing.
    expect(files).toContain(
      path.normalize('app/(timeline)/messages/MessagesPage.tsx')
    )
    expect(files).toContain(path.normalize('lib/components/surface/Alert.tsx'))
    const inBox = files
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
