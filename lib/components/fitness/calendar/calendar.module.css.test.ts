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

  it('makes the month-label button itself 44px tall without leaving its row', () => {
    const rule = sheet.match(/\.monthLabel\s*\{([^}]*)\}/)
    expect(rule).not.toBeNull()
    const body = rule![1]
    const height = Number(body.match(/height:\s*(\d+)px/)?.[1])
    const margin = body.match(/margin:\s*(-?\d+)px\s+0\s+(-?\d+)px/)
    expect(margin).not.toBeNull()
    const above = -Number(margin![1])
    const below = -Number(margin![2])
    // The element is 44px (not a pseudo-element: a bounding-box measurement
    // must agree with the hit area); its margin box is the 14px label row, so
    // it reaches up into the scroller's 27px top padding and down 3px into the
    // gap above the cells, and moves nothing.
    expect(height).toBe(44)
    expect(height - above - below).toBe(14)
    expect(above).toBeLessThanOrEqual(27)
    expect(below).toBeLessThanOrEqual(3)
    expect(sheet).not.toMatch(/\.monthLabel::before/)
  })

  it('fades the scroller edges through the registered mask variables', () => {
    expect(sheet).toContain('--fitness-fade-start')
    expect(sheet).toContain('--fitness-fade-end')
    expect(sheet).toMatch(/mask-image:\s*linear-gradient/)
    expect(sheet).toContain("[data-fade-start='true']")
    expect(sheet).toContain("[data-fade-end='true']")
  })

  it('never animates movement: no transforms, and only the loading sweep animates', () => {
    expect(sheet).not.toMatch(/transition:[^;]*transform/)
    expect(
      [...sheet.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])
    ).toEqual(['cell-loading-sweep'])
    expect(
      [...sheet.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1])
    ).toEqual(['cell-loading-sweep 1.6s ease-in-out infinite', 'none'])
  })

  it('shimmers the loading skeleton with one viewport-attached band', () => {
    expect(sheet).toMatch(
      /\[data-loading='true'\]\[data-state='active'\]\s*\{[^}]*background-color:\s*var\(--skeleton\)[^}]*var\(--skeleton-highlight\)[^}]*background-attachment:\s*fixed[^}]*animation:\s*cell-loading-sweep/
    )
    expect(sheet).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.cell\[data-loading='true'\]\[data-state='active'\]\s*\{\s*animation:\s*none;\s*background-image:\s*none;/
    )
  })
})
