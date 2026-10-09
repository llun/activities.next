import { describe, expect, it } from 'vitest'

import {
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
  PresentationInput,
  choosePresentation
} from './rangePickerPresentation'

// Real geometry measured in a browser. `main` reserves the 72px navigation rail
// as padding, so its CONTENT box starts at 72 and ends at the viewport's right
// edge. The Range button sits in the page header, 16px in from that edge and
// 155px below the top.
//
// Tablet landscape 1194 x 834: the column is 1122px wide.
const landscape: PresentationInput = {
  viewport: { width: 1194, height: 834 },
  trigger: { left: 934, right: 1087, top: 155, bottom: 199 },
  boundaryLeft: 72,
  boundaryRight: 1194
}

// Tablet portrait 834 x 1194: the column is 762px wide, short of the 774px the
// popover needs (710 + 2 x 32), although the trigger's right edge is 746px from
// the column's left edge, which on its own would pass a "room on the left" test.
const portrait: PresentationInput = {
  viewport: { width: 834, height: 1194 },
  trigger: { left: 665, right: 818, top: 155, bottom: 199 },
  boundaryLeft: 72,
  boundaryRight: 834
}

describe('choosePresentation', () => {
  it.each<[string, PresentationInput, 'popover' | 'sheet']>([
    ['anchors a popover on tablet landscape', landscape, 'popover'],
    [
      'uses the sheet on tablet portrait, where the main column is too narrow',
      portrait,
      'sheet'
    ],
    [
      'uses the sheet at 768 x 1024 too',
      {
        viewport: { width: 768, height: 1024 },
        trigger: { left: 599, right: 752, top: 155, bottom: 199 },
        boundaryLeft: 72,
        boundaryRight: 768
      },
      'sheet'
    ],
    [
      'uses the sheet on a phone',
      {
        viewport: { width: 390, height: 844 },
        trigger: { left: 280, right: 374, top: 200, bottom: 244 }
      },
      'sheet'
    ]
  ])('%s', (_title, input, expected) => {
    expect(choosePresentation(input)).toBe(expected)
  })

  it('needs the whole height: below the trigger or above it', () => {
    // 199 + 8 + 410 + 32 = 649: a 600px viewport has no room below...
    const short = { ...landscape, viewport: { width: 1194, height: 600 } }
    expect(choosePresentation(short)).toBe('sheet')
    // ...unless the trigger sits low enough for the panel to open upward.
    expect(
      choosePresentation({
        ...short,
        trigger: { left: 934, right: 1087, top: 520, bottom: 564 }
      })
    ).toBe('popover')
    // The exact boundary: 410 + 8 + 32 below the trigger.
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 199 + 8 + POPOVER_HEIGHT + 32 }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 199 + 8 + POPOVER_HEIGHT + 31 }
      })
    ).toBe('sheet')
  })

  it('needs the horizontal room back to the main column plus a margin', () => {
    const fit = 72 + POPOVER_WIDTH + 32
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: fit - 100, right: fit, top: 155, bottom: 199 }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: fit - 101, right: fit - 1, top: 155, bottom: 199 }
      })
    ).toBe('sheet')
  })

  it('needs a main column wide enough for the panel and a margin on each side', () => {
    const column = POPOVER_WIDTH + 2 * 32
    // Same trigger, same viewport: only the column's right edge moves.
    const fits = { ...portrait, viewport: { width: 1194, height: 1194 } }
    expect(choosePresentation({ ...fits, boundaryRight: 72 + column })).toBe(
      'popover'
    )
    expect(
      choosePresentation({ ...fits, boundaryRight: 72 + column - 1 })
    ).toBe('sheet')
  })

  it('uses the sheet from 780 to 845px of viewport, where the column is under 774px', () => {
    for (const width of [780, 800, 820, 834, 845]) {
      expect(
        choosePresentation({
          viewport: { width, height: 1194 },
          trigger: {
            left: width - 169,
            right: width - 16,
            top: 155,
            bottom: 199
          },
          boundaryLeft: 72,
          boundaryRight: width
        })
      ).toBe('sheet')
    }
    expect(
      choosePresentation({
        viewport: { width: 846, height: 1194 },
        trigger: { left: 677, right: 830, top: 155, bottom: 199 },
        boundaryLeft: 72,
        boundaryRight: 846
      })
    ).toBe('popover')
  })

  it('grows the needed height with the panel (an inline error)', () => {
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 660 },
        panel: { width: POPOVER_WIDTH, height: POPOVER_HEIGHT }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 660 },
        panel: { width: POPOVER_WIDTH, height: POPOVER_HEIGHT + 40 }
      })
    ).toBe('sheet')
  })

  it('falls back to the sheet for unusable measurements', () => {
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: NaN, right: NaN, top: NaN, bottom: NaN }
      })
    ).toBe('sheet')
    // A trigger that has not been laid out.
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: 0, right: 0, top: 0, bottom: 0 }
      })
    ).toBe('sheet')
  })
})
