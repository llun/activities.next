import { NEUTRAL_RECIPE } from '@/lib/services/medias/edit/recipe'

import { focusToPoint, focusToSourcePoint } from './focusPoint'

describe('focusToPoint', () => {
  it.each([
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 }
    ],
    [
      { x: -1, y: 1 },
      { x: 0, y: 0 }
    ],
    [
      { x: 1, y: -1 },
      { x: 1, y: 1 }
    ],
    [
      { x: 0.5, y: 0.5 },
      { x: 0.75, y: 0.25 }
    ],
    [
      { x: -0.5, y: -0.5 },
      { x: 0.25, y: 0.75 }
    ]
  ])('maps focus %j to the point %j (y is flipped)', (focus, expected) => {
    expect(focusToPoint(focus)).toEqual({ ...expected, label: 1 })
  })

  it.each([null, undefined])('uses the centre with %s focus', (focus) => {
    expect(focusToPoint(focus)).toEqual({ x: 0.5, y: 0.5, label: 1 })
  })

  it('keeps the point inside the image for a focus outside -1..1', () => {
    expect(focusToPoint({ x: 3, y: -4 })).toEqual({ x: 1, y: 1, label: 1 })
  })
})

describe('focusToSourcePoint', () => {
  const source = { width: 4000, height: 3000 }

  it('is the plain mapping for a photo that was never edited', () => {
    expect(focusToSourcePoint({ x: 0.5, y: 0 }, source, null)).toEqual(
      focusToPoint({ x: 0.5, y: 0 })
    )
  })

  it('is the plain mapping for a neutral geometry', () => {
    const point = focusToSourcePoint(
      { x: 0.5, y: 0.5 },
      source,
      NEUTRAL_RECIPE.geometry
    )
    expect(point.x).toBeCloseTo(0.75, 6)
    expect(point.y).toBeCloseTo(0.25, 6)
  })

  it('carries a focus of the saved render back through a flip', () => {
    const point = focusToSourcePoint({ x: 0.5, y: 0 }, source, {
      ...NEUTRAL_RECIPE.geometry,
      flipH: true
    })
    // Right of centre in the mirrored render is left of centre in the source.
    expect(point.x).toBeCloseTo(0.25, 6)
    expect(point.y).toBeCloseTo(0.5, 6)
  })

  it('carries a focus of the saved render back through a crop', () => {
    const point = focusToSourcePoint({ x: 0, y: 0 }, source, {
      ...NEUTRAL_RECIPE.geometry,
      crop: { x: 0.5, y: 0, width: 0.5, height: 1 },
      aspect: 'free'
    })
    // The centre of the right half is at 0.75 of the source.
    expect(point.x).toBeCloseTo(0.75, 6)
    expect(point.y).toBeCloseTo(0.5, 6)
  })
})
