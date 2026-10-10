import {
  type Matrix,
  aspectCrop,
  clampCropToImage,
  flipGeometryHorizontal,
  getGeometryTransform,
  getOrientedSize,
  getRecipeOutputSize,
  rotateGeometry90
} from '@/lib/services/medias/edit/geometry'
import {
  type CropRect,
  type Geometry,
  NEUTRAL_RECIPE
} from '@/lib/services/medias/edit/recipe'

const geometry = (overrides: Partial<Geometry> = {}): Geometry => ({
  ...NEUTRAL_RECIPE.geometry,
  ...overrides
})

const apply = (m: Matrix, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f
})

const corners = (
  crop: CropRect,
  straighten: number,
  size: { width: number; height: number }
) => {
  const cx = (crop.x + crop.width / 2) * size.width
  const cy = (crop.y + crop.height / 2) * size.height
  const hw = (crop.width * size.width) / 2
  const hh = (crop.height * size.height) / 2
  const t = (straighten * Math.PI) / 180
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh]
  ].map(([dx, dy]) => ({
    x: cx + dx * Math.cos(t) - dy * Math.sin(t),
    y: cy + dx * Math.sin(t) + dy * Math.cos(t)
  }))
}

const expectInside = (
  crop: CropRect,
  straighten: number,
  size: { width: number; height: number }
) => {
  for (const point of corners(crop, straighten, size)) {
    expect(point.x).toBeGreaterThanOrEqual(-1e-6)
    expect(point.y).toBeGreaterThanOrEqual(-1e-6)
    expect(point.x).toBeLessThanOrEqual(size.width + 1e-6)
    expect(point.y).toBeLessThanOrEqual(size.height + 1e-6)
  }
}

describe('getOrientedSize', () => {
  it.each([
    [0, 300, 200],
    [1, 200, 300],
    [2, 300, 200],
    [3, 200, 300]
  ] as const)('rotate90 %s gives %sx%s', (rotate90, width, height) => {
    expect(getOrientedSize({ width: 300, height: 200 }, rotate90)).toEqual({
      width,
      height
    })
  })
})

describe('getRecipeOutputSize', () => {
  const source = { width: 1200, height: 800 }

  it.each([
    [0, false, 1200, 800],
    [1, false, 800, 1200],
    [2, true, 1200, 800],
    [3, true, 800, 1200]
  ] as const)(
    'rotate90 %s flip %s gives %sx%s',
    (rotate90, flipH, width, height) => {
      expect(
        getRecipeOutputSize(source, { geometry: geometry({ rotate90, flipH }) })
      ).toEqual({ width, height })
    }
  )

  it('uses the crop in the oriented frame', () => {
    const crop = { x: 0, y: 0, width: 0.5, height: 0.25 }
    expect(
      getRecipeOutputSize(source, { geometry: geometry({ crop }) })
    ).toEqual({
      width: 600,
      height: 200
    })
    expect(
      getRecipeOutputSize(source, { geometry: geometry({ crop, rotate90: 1 }) })
    ).toEqual({ width: 400, height: 300 })
  })

  it.each([
    [{ width: 8000, height: 6000 }, 4000, 3000],
    [{ width: 6000, height: 8000 }, 3000, 4000],
    [{ width: 4000, height: 3000 }, 4000, 3000],
    [{ width: 4001, height: 4001 }, 4000, 4000]
  ])('caps the long edge of %j at 4000', (size, width, height) => {
    expect(getRecipeOutputSize(size, { geometry: geometry() })).toEqual({
      width,
      height
    })
  })

  it('never returns less than 1 pixel', () => {
    const crop = { x: 0, y: 0, width: 0.0001, height: 0.0001 }
    expect(
      getRecipeOutputSize(source, { geometry: geometry({ crop }) })
    ).toEqual({
      width: 1,
      height: 1
    })
  })
})

describe('clampCropToImage', () => {
  const size = { width: 1000, height: 600 }
  const full = { x: 0, y: 0, width: 1, height: 1 }

  it('leaves a crop that fits unchanged', () => {
    const crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }
    expect(clampCropToImage(crop, 0, size)).toEqual(crop)
    expect(clampCropToImage(full, 0, size)).toEqual(full)
  })

  it('slides a crop back inside without shrinking it', () => {
    const result = clampCropToImage(
      { x: 0.8, y: -0.1 + 0.1, width: 0.4, height: 0.5 },
      0,
      size
    )
    expect(result.width).toBeCloseTo(0.4)
    expect(result.x + result.width).toBeCloseTo(1)
  })

  it.each([-45, -30, -7.5, 0.1, 5, 12, 30, 45])(
    'keeps every rotated corner inside at straighten %s',
    (straighten) => {
      const result = clampCropToImage(full, straighten, size)
      expectInside(result, straighten, size)
      expect(result.width).toBeLessThanOrEqual(1)
    }
  )

  it('keeps the aspect and the centre when shrinking', () => {
    const crop = { x: 0, y: 0, width: 1, height: 1 }
    const result = clampCropToImage(crop, 10, size)
    expect(
      (result.width * size.width) / (result.height * size.height)
    ).toBeCloseTo(size.width / size.height)
    expect(result.x + result.width / 2).toBeCloseTo(0.5)
    expect(result.y + result.height / 2).toBeCloseTo(0.5)
    expect(result.width).toBeLessThan(1)
  })

  it('handles off-centre crops at an angle and stays valid', () => {
    const result = clampCropToImage(
      { x: 0.7, y: 0.6, width: 0.5, height: 0.6 },
      -20,
      size
    )
    expectInside(result, -20, size)
    expect(result.x).toBeGreaterThanOrEqual(0)
    expect(result.x + result.width).toBeLessThanOrEqual(1)
    expect(result.y + result.height).toBeLessThanOrEqual(1)
  })
})

describe('aspectCrop', () => {
  const size = { width: 1000, height: 600 }
  const current = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 }
  const ratio = (crop: CropRect) =>
    (crop.width * size.width) / (crop.height * size.height)

  it.each([
    ['1:1', 1],
    ['4:5', 4 / 5],
    ['3:2', 3 / 2],
    ['16:9', 16 / 9]
  ] as const)('produces a %s crop', (aspect, expected) => {
    const crop = aspectCrop(aspect, false, size, current)
    expect(ratio(crop)).toBeCloseTo(expected, 5)
    expectInside(crop, 0, size)
  })

  it.each([
    ['4:5', 5 / 4],
    ['16:9', 9 / 16],
    ['1:1', 1]
  ] as const)('swaps %s for portrait', (aspect, expected) => {
    expect(ratio(aspectCrop(aspect, true, size, current))).toBeCloseTo(
      expected,
      5
    )
  })

  it('is the largest crop that fits', () => {
    const wide = aspectCrop('16:9', false, size, current)
    expect(wide.width).toBeCloseTo(1)
    const square = aspectCrop('1:1', false, size, current)
    expect(square.height).toBeCloseTo(1)
    expect(square.width).toBeCloseTo(0.6)
  })

  it('uses the oriented ratio for original and returns current for free', () => {
    expect(aspectCrop('original', false, size, current)).toMatchObject({
      width: 1,
      height: 1
    })
    expect(aspectCrop('free', false, size, current)).toBe(current)
  })

  it('centres on the current crop where there is room', () => {
    const centred = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 }
    const crop = aspectCrop('1:1', false, size, centred)
    expect(crop.x + crop.width / 2).toBeCloseTo(0.5)
    expect(crop.y + crop.height / 2).toBeCloseTo(0.5)
  })

  it('clamps for straighten', () => {
    const crop = aspectCrop('3:2', false, size, current, 15)
    expectInside(crop, 15, size)
    expect(ratio(crop)).toBeCloseTo(1.5, 5)
  })
})

describe('getGeometryTransform', () => {
  const source = { width: 400, height: 200 }

  it('maps the source to the output for a neutral recipe', () => {
    const m = getGeometryTransform(source, geometry())
    expect(apply(m, 0, 0)).toEqual({ x: 0, y: 0 })
    const far = apply(m, 400, 200)
    expect(far.x).toBeCloseTo(400)
    expect(far.y).toBeCloseTo(200)
  })

  it('maps a source corner for each clockwise quarter turn', () => {
    // Source top-left goes to top-right, bottom-right, bottom-left
    const expected = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 200 },
      { x: 0, y: 400 }
    ]
    ;([0, 1, 2, 3] as const).forEach((rotate90, i) => {
      const point = apply(
        getGeometryTransform(source, geometry({ rotate90 })),
        0,
        0
      )
      if (rotate90 === 1) expect(point).toEqual({ x: 200, y: 0 })
      if (rotate90 === 2) expect(point).toEqual({ x: 400, y: 200 })
      if (rotate90 === 3) expect(point).toEqual({ x: 0, y: 400 })
      if (rotate90 === 0) expect(point).toEqual(expected[i])
    })
  })

  it('mirrors after rotating', () => {
    const m = getGeometryTransform(source, geometry({ flipH: true }))
    expect(apply(m, 0, 0)).toEqual({ x: 400, y: 0 })
  })

  it('maps the crop centre to the output centre at any angle', () => {
    const g = geometry({
      rotate90: 1,
      flipH: true,
      straighten: 17,
      crop: { x: 0.1, y: 0.3, width: 0.5, height: 0.4 }
    })
    const out = getRecipeOutputSize(source, { geometry: g })
    const m = getGeometryTransform(source, g)
    // Oriented frame is 200x400 and flipped after the quarter turn: find the
    // source point that lands at the crop centre by inverting the matrix
    const det = m.a * m.d - m.b * m.c
    const x = (m.d * (out.width / 2 - m.e) - m.c * (out.height / 2 - m.f)) / det
    const y = (m.a * (out.height / 2 - m.f) - m.b * (out.width / 2 - m.e)) / det
    const back = apply(m, x, y)
    expect(back.x).toBeCloseTo(out.width / 2)
    expect(back.y).toBeCloseTo(out.height / 2)
    expect(x).toBeGreaterThan(0)
    expect(x).toBeLessThan(source.width)
    expect(y).toBeGreaterThan(0)
    expect(y).toBeLessThan(source.height)
  })

  it('rotates clockwise for positive straighten', () => {
    const m = getGeometryTransform(source, geometry({ straighten: 90 - 45 }))
    const centre = apply(m, 200, 100)
    expect(centre.x).toBeCloseTo(200)
    // The point right of centre moves down on screen
    expect(apply(m, 300, 100).y).toBeGreaterThan(centre.y)
  })

  it('scales to a capped output size', () => {
    const big = { width: 8000, height: 4000 }
    const m = getGeometryTransform(big, geometry())
    expect(apply(m, 8000, 4000).x).toBeCloseTo(4000)
  })
})

describe('rotateGeometry90 and flipGeometryHorizontal', () => {
  const source = { width: 400, height: 200 }
  const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.5 }

  /** Source-space centre of the crop, found by inverting the transform. */
  const regionCentre = (g: Geometry) => {
    const out = getRecipeOutputSize(source, { geometry: g })
    const m = getGeometryTransform(source, g, out)
    const det = m.a * m.d - m.b * m.c
    const u = out.width / 2 - m.e
    const v = out.height / 2 - m.f
    return { x: (m.d * u - m.c * v) / det, y: (m.a * v - m.b * u) / det }
  }

  const start = (
    flipH: boolean,
    rotate90: Geometry['rotate90'],
    straighten = 0
  ) => geometry({ flipH, rotate90, straighten, crop })

  it.each([
    [false, 0],
    [false, 1],
    [false, 2],
    [false, 3],
    [true, 0],
    [true, 1],
    [true, 2],
    [true, 3]
  ] as const)(
    'rotating keeps the same region (flip %s, rotate90 %s)',
    (flipH, rotate90) => {
      const before = start(flipH, rotate90, 8)
      const after = rotateGeometry90(before)
      expect(regionCentre(after).x).toBeCloseTo(regionCentre(before).x, 6)
      expect(regionCentre(after).y).toBeCloseTo(regionCentre(before).y, 6)
      expect(after.straighten).toBe(8)
      const a = getRecipeOutputSize(source, { geometry: before })
      const b = getRecipeOutputSize(source, { geometry: after })
      expect(b).toEqual({ width: a.height, height: a.width })
    }
  )

  it('turns the picture counterclockwise on screen', () => {
    // Unflipped, the source top-left corner is top-left and a counterclockwise
    // turn sends it to bottom-left. Flipped, it starts top-right and a
    // counterclockwise turn sends it to top-left.
    const full = { x: 0, y: 0, width: 1, height: 1 }
    for (const flipH of [false, true]) {
      const g = rotateGeometry90(geometry({ flipH, crop: full }))
      const m = getGeometryTransform(source, g)
      const before = apply(
        getGeometryTransform(source, geometry({ flipH, crop: full })),
        0,
        0
      )
      const after = apply(m, 0, 0)
      const origin = { x: flipH ? 400 : 0, y: 0 }
      expect(before).toEqual(origin)
      // Corner order around the 200x400 frame
      expect(after).toEqual(flipH ? { x: 0, y: 0 } : { x: 0, y: 400 })
    }
  })

  it('uses (r + 3) % 4 without a flip', () => {
    expect(rotateGeometry90(start(false, 0)).rotate90).toBe(3)
    expect(rotateGeometry90(start(false, 3)).rotate90).toBe(2)
  })

  it('four turns return to the start', () => {
    const before = start(false, 1)
    let g = before
    for (let i = 0; i < 4; i++) g = rotateGeometry90(g)
    expect(g.rotate90).toBe(before.rotate90)
    expect(g.crop.x).toBeCloseTo(crop.x)
    expect(g.crop.y).toBeCloseTo(crop.y)
    expect(g.crop.width).toBeCloseTo(crop.width)
    expect(g.crop.height).toBeCloseTo(crop.height)
  })

  it('swaps the orientation of a fixed ratio but not original or free', () => {
    const fixed = rotateGeometry90(geometry({ aspect: '4:5' }))
    expect(fixed.aspectPortrait).toBe(true)
    expect(rotateGeometry90(fixed).aspectPortrait).toBe(false)
    expect(
      rotateGeometry90(geometry({ aspect: 'original' }))
    ).not.toHaveProperty('aspectPortrait')
    expect(rotateGeometry90(geometry({ aspect: 'free' }))).not.toHaveProperty(
      'aspectPortrait'
    )
  })

  it.each([0, 1, 2, 3] as const)(
    'flipping keeps the same region (rotate90 %s)',
    (rotate90) => {
      const before = start(false, rotate90, 12.5)
      const after = flipGeometryHorizontal(before)
      expect(after.flipH).toBe(true)
      expect(after.straighten).toBe(-12.5)
      expect(after.crop.x).toBeCloseTo(1 - crop.x - crop.width)
      expect(after.crop.width).toBe(crop.width)
      expect(regionCentre(after).x).toBeCloseTo(regionCentre(before).x, 6)
      expect(regionCentre(after).y).toBeCloseTo(regionCentre(before).y, 6)
    }
  )

  it('flipping twice is the identity and keeps straighten at 0 non-negative', () => {
    const before = start(false, 2)
    const twice = flipGeometryHorizontal(flipGeometryHorizontal(before))
    expect(twice.crop.x).toBeCloseTo(before.crop.x)
    expect(twice.flipH).toBe(false)
    expect(Object.is(flipGeometryHorizontal(before).straighten, 0)).toBe(true)
  })
})
