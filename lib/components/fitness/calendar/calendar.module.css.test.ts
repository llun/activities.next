import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * jsdom lays nothing out and applies no stylesheet, so the visual contract of
 * the calendar's CSS module is guarded by reading it: the selectors the
 * components emit as data attributes must exist, every colour token it reads
 * must be defined, and the month-label hit band must be 44px.
 */
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

const sheet = read('lib/components/fitness/calendar/calendar.module.css')
const globals = read('app/globals.css')

describe('calendar stylesheet', () => {
  it.each([1, 2, 3, 4])(
    'colours heat level %i from its token pair',
    (level) => {
      expect(sheet).toMatch(
        new RegExp(
          `\\[data-level='${level}'\\]\\s*\\{[^}]*--cell-bg:\\s*var\\(--heat-${level}\\)[^}]*--cell-fg:\\s*var\\(--heat-${level}-fg\\)`
        )
      )
    }
  )

  it.each([
    ["[data-state='upcoming']", 'upcoming'],
    ["[data-state='out']", 'slashed out-of-range'],
    ["[data-loading='true']", 'loading skeleton'],
    ["[aria-pressed='true']::after", 'selected ring'],
    [':focus-visible::before', 'focus brackets']
  ])('styles %s (%s)', (selector) => {
    expect(sheet).toContain(selector)
  })

  it('only reads colour tokens that exist', () => {
    const used = new Set(
      [...sheet.matchAll(/var\((--heat-[\w-]+)\)/g)].map((match) => match[1])
    )
    const defined = globals.match(/\.fitness-heat\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(used.size).toBeGreaterThan(5)
    for (const token of used) {
      expect(defined, `${token} is defined on .fitness-heat`).toContain(
        `${token}:`
      )
    }
  })

  it('only reads motion tokens that exist', () => {
    const used = new Set(
      [...sheet.matchAll(/var\((--fitness-t-[\w-]+)\)/g)].map(
        (match) => match[1]
      )
    )

    expect(used.size).toBeGreaterThan(3)
    for (const token of used) {
      expect(globals, `${token} is defined`).toContain(`${token}:`)
    }
  })

  it('makes the month-label hit band 44px tall without leaving its row', () => {
    const band = sheet.match(
      /\.monthLabel::before\s*\{[^}]*inset:\s*(-?\d+)px\s+(-?\d+)px\s+(-?\d+)px/
    )
    expect(band).not.toBeNull()
    const above = -Number(band![1])
    const below = -Number(band![3])
    // 14px of label between them; the band stops at the cells (3px gap) and
    // starts inside the scroller's 27px top padding.
    expect(above + 14 + below).toBe(44)
    expect(above).toBeLessThanOrEqual(27)
    expect(below).toBeLessThanOrEqual(3)
  })

  it('fades the scroller edges through the registered mask variables', () => {
    expect(sheet).toContain('--fitness-fade-start')
    expect(sheet).toContain('--fitness-fade-end')
    expect(sheet).toMatch(/mask-image:\s*linear-gradient/)
    expect(sheet).toContain("[data-fade-start='true']")
    expect(sheet).toContain("[data-fade-end='true']")
  })

  it('never animates movement: no transform transitions, no keyframes', () => {
    expect(sheet).not.toMatch(/@keyframes/)
    expect(sheet).not.toMatch(/transition:[^;]*transform/)
    expect(sheet).not.toMatch(/animation:/)
  })

  it('does not add a shimmer to the loading skeleton', () => {
    expect(sheet).not.toMatch(/shimmer/)
  })
})
