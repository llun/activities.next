import { type PixelContext, applyAdjustments } from './adjustments'
import { type Rgb, linearToSrgb, luma, srgbToLinear } from './colour'

const context = (
  rgb: Rgb,
  overrides: Partial<PixelContext> = {}
): PixelContext => ({
  tone: linearToSrgb(
    luma(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]))
  ),
  mid: linearToSrgb(
    luma(srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2]))
  ),
  fine: rgb,
  uv: [0.5, 0.5],
  ...overrides
})

const apply = (
  rgb: Rgb,
  adjustments: Parameters<typeof applyAdjustments>[1],
  overrides: Partial<PixelContext> = {}
) => applyAdjustments(rgb, adjustments, context(rgb, overrides))

const grid: Rgb[] = []
for (const r of [0, 0.25, 0.5, 0.75, 1]) {
  for (const g of [0, 0.3, 0.6, 1]) {
    for (const b of [0, 0.2, 0.5, 0.9, 1]) grid.push([r, g, b])
  }
}

describe('applyAdjustments', () => {
  it.each(grid.map((rgb) => [rgb.join(','), rgb] as const))(
    'neutral is the identity for %s',
    (_name, rgb) => {
      const out = apply(rgb, {}, { uv: [0.1, 0.9] })
      out.forEach((value, i) => {
        expect(Math.abs(value - rgb[i])).toBeLessThan(1 / 255)
      })
    }
  )

  it.each([
    [1, 2],
    [-1, 0.5]
  ])('exposure %i EV scales linear light by %f', (exposure, factor) => {
    const input: Rgb = [0.2, 0.2, 0.2]
    const out = apply(input, { exposure })
    expect(srgbToLinear(out[0])).toBeCloseTo(srgbToLinear(0.2) * factor, 4)
  })

  it.each([-100, -40, 40, 100])(
    'white balance %i keeps luma',
    (temperature) => {
      const input: Rgb = [0.4, 0.4, 0.4]
      const out = apply(input, { temperature })
      const before = luma(...(input.map(srgbToLinear) as Rgb))
      const after = luma(...(out.map(srgbToLinear) as Rgb))
      expect(after).toBeCloseTo(before, 3)
    }
  )

  it('warms with a positive temperature and tints green with a negative tint', () => {
    const warm = apply([0.5, 0.5, 0.5], { temperature: 50 })
    expect(warm[0]).toBeGreaterThan(warm[2])
    const magenta = apply([0.5, 0.5, 0.5], { tint: 50 })
    expect(magenta[1]).toBeLessThan(magenta[0])
  })

  it.each([0, 0.5, 1])('contrast leaves %f in place', (value) => {
    for (const contrast of [-100, -50, 50, 100]) {
      const out = apply([value, value, value], { contrast })
      expect(out[0]).toBeCloseTo(value, 2)
    }
  })

  it('contrast pushes tones apart and back together', () => {
    expect(apply([0.7, 0.7, 0.7], { contrast: 80 })[0]).toBeGreaterThan(0.7)
    expect(apply([0.3, 0.3, 0.3], { contrast: 80 })[0]).toBeLessThan(0.3)
    expect(apply([0.7, 0.7, 0.7], { contrast: -80 })[0]).toBeLessThan(0.7)
  })

  it('saturation -100 gives grey', () => {
    const out = apply([0.9, 0.3, 0.1], { saturation: -100 })
    expect(out[0]).toBeCloseTo(out[1], 3)
    expect(out[1]).toBeCloseTo(out[2], 3)
  })

  it('vibrance lifts muted colours more than vivid ones', () => {
    const muted = apply([0.5, 0.45, 0.4], { vibrance: 80 })
    const vivid = apply([1, 0.1, 0.1], { vibrance: 80 })
    const spread = (rgb: Rgb) => Math.max(...rgb) - Math.min(...rgb)
    expect(spread(muted) / 0.1).toBeGreaterThan(spread(vivid) / 0.9)
  })

  it('highlights recover values pushed above 1', () => {
    const brightened = apply([0.9, 0.9, 0.9], { exposure: 1 })
    const recovered = apply([0.9, 0.9, 0.9], { exposure: 1, highlights: -100 })
    expect(brightened[0]).toBe(1)
    expect(recovered[0]).toBeLessThan(1)
    expect(recovered[0]).toBeGreaterThan(0.5)
  })

  it('shadows lift dark areas and leave bright ones', () => {
    const dark = apply([0.1, 0.1, 0.1], { shadows: 100 })
    expect(dark[0]).toBeGreaterThan(0.1)
    const bright = apply([0.95, 0.95, 0.95], { shadows: 100 })
    expect(bright[0]).toBeCloseTo(0.95, 2)
  })

  it('whites and blacks move the end points', () => {
    expect(apply([0.8, 0.8, 0.8], { whites: 100 })[0]).toBeGreaterThan(0.8)
    expect(apply([0.1, 0.1, 0.1], { blacks: -100 })[0]).toBeLessThan(0.1)
  })

  it('texture sharpens against the fine neighbourhood', () => {
    const rgb: Rgb = [0.6, 0.6, 0.6]
    const out = apply(rgb, { texture: 100 }, { fine: [0.4, 0.4, 0.4] })
    expect(out[0]).toBeGreaterThan(0.6)
    const soft = apply(rgb, { texture: -100 }, { fine: [0.4, 0.4, 0.4] })
    expect(soft[0]).toBeLessThan(0.6)
  })

  it('clarity acts against the mid blur', () => {
    const rgb: Rgb = [0.6, 0.6, 0.6]
    const out = apply(rgb, { clarity: 100 }, { mid: 0.4 })
    expect(out[0]).toBeGreaterThan(0.6)
  })

  it('vignette is 0 at the centre and darkens the corners', () => {
    const centre = apply(
      [0.6, 0.6, 0.6],
      { vignette: -100 },
      { uv: [0.5, 0.5] }
    )
    expect(centre[0]).toBeCloseTo(0.6, 4)
    const corner = apply([0.6, 0.6, 0.6], { vignette: -100 }, { uv: [0, 0] })
    expect(corner[0]).toBeLessThan(0.5)
    const lighter = apply([0.6, 0.6, 0.6], { vignette: 100 }, { uv: [0, 0] })
    expect(lighter[0]).toBeGreaterThan(0.6)
  })

  it('always returns values in 0..1', () => {
    for (const rgb of grid) {
      const out = apply(
        rgb,
        { exposure: 3, contrast: 100, saturation: 100, vibrance: 100 },
        { uv: [0, 0] }
      )
      out.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      })
    }
  })
})
