import { describe, expect, it } from 'vitest'

import {
  POPOVER_HEIGHT,
  POPOVER_WIDTH,
  PresentationInput,
  choosePresentation
} from './rangePickerPresentation'

// Tablet landscape 1194 x 834: the main column starts after a 72px rail and
// the Range button sits at its right edge, 195px below the top.
const landscape: PresentationInput = {
  viewport: { width: 1194, height: 834 },
  trigger: { left: 1000, right: 1162, top: 130, bottom: 170 },
  boundaryLeft: 72
}

// Tablet portrait 834 x 1194: the main column (762px) cannot hold the panel
// plus its margins even though the viewport is wider than the panel.
const portrait: PresentationInput = {
  viewport: { width: 834, height: 1194 },
  trigger: { left: 640, right: 802, top: 130, bottom: 170 },
  boundaryLeft: 72
}

describe('choosePresentation', () => {
  it('anchors a popover on tablet landscape', () => {
    expect(choosePresentation(landscape)).toBe('popover')
  })

  it('uses the sheet on tablet portrait, where the main column is too narrow', () => {
    expect(choosePresentation(portrait)).toBe('sheet')
  })

  it('uses the sheet at 768 x 1024 too', () => {
    expect(
      choosePresentation({
        viewport: { width: 768, height: 1024 },
        trigger: { left: 580, right: 736, top: 130, bottom: 170 },
        boundaryLeft: 72
      })
    ).toBe('sheet')
  })

  it('uses the sheet on a phone', () => {
    expect(
      choosePresentation({
        viewport: { width: 390, height: 844 },
        trigger: { left: 280, right: 374, top: 200, bottom: 244 }
      })
    ).toBe('sheet')
  })

  it('needs the whole height: below the trigger or above it', () => {
    // 170 + 8 + 410 + 32 = 620: a 600px viewport has no room below...
    const short = { ...landscape, viewport: { width: 1194, height: 600 } }
    expect(choosePresentation(short)).toBe('sheet')
    // ...unless the trigger sits low enough for the panel to open upward.
    expect(
      choosePresentation({
        ...short,
        trigger: { left: 1000, right: 1162, top: 520, bottom: 560 }
      })
    ).toBe('popover')
    // The exact boundary: 410 + 8 + 32 below the trigger.
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 170 + 8 + POPOVER_HEIGHT + 32 }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 170 + 8 + POPOVER_HEIGHT + 31 }
      })
    ).toBe('sheet')
  })

  it('needs the horizontal room back to the main column plus a margin', () => {
    const fit = 72 + POPOVER_WIDTH + 32
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: fit - 100, right: fit, top: 130, bottom: 170 }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        trigger: { left: fit - 101, right: fit - 1, top: 130, bottom: 170 }
      })
    ).toBe('sheet')
  })

  it('grows the needed height with the panel (an inline error)', () => {
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 640 },
        panel: { width: POPOVER_WIDTH, height: POPOVER_HEIGHT }
      })
    ).toBe('popover')
    expect(
      choosePresentation({
        ...landscape,
        viewport: { width: 1194, height: 640 },
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
