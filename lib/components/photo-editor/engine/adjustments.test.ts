import {
  type MaskLayer,
  type PixelContext,
  applyAdjustments,
  applyAdjustmentsWithMasks,
  applyAdjustmentsWithTerms,
  applyMaskAdjustments
} from './adjustments'
import {
  type Rgb,
  applyLevels,
  linearToSrgb,
  luma,
  srgbToLinear
} from './colour'

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

  it('applyLevels preserves identity at 0, 0 and localized shoulder/toe', () => {
    for (const x of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      expect(applyLevels(x, 0, 0)).toBeCloseTo(x, 6)
    }
    // Raising whites lifts bright tones (> 0.25) but leaves shadows (<= 0.25) untouched
    expect(applyLevels(0.2, 1, 0)).toBe(0.2)
    expect(applyLevels(0.25, 1, 0)).toBe(0.25)
    expect(applyLevels(0.8, 1, 0)).toBeGreaterThan(0.8)

    // Lowering whites recovers highlights without darkening shadows
    expect(applyLevels(0.1, -1, 0)).toBe(0.1)
    expect(applyLevels(0.9, -1, 0)).toBeLessThan(0.9)

    // Raising blacks lifts dark shadows (< 0.75) but leaves highlights (>= 0.75) untouched
    expect(applyLevels(0.2, 0, 1)).toBeGreaterThan(0.2)
    expect(applyLevels(0.75, 0, 1)).toBe(0.75)
    expect(applyLevels(0.9, 0, 1)).toBe(0.9)

    // Lowering blacks deepens shadows and anchors 0 at 0
    expect(applyLevels(0, 0, -1)).toBe(0)
    expect(applyLevels(0.2, 0, -1)).toBeLessThan(0.2)
  })

  it('edge-aware tone prevents haloing across sharp high-contrast edges', () => {
    // Sharp edge: pixel is bright (0.9), but blurred tone is dark (0.1)
    const sharpEdgeCtx = context([0.9, 0.9, 0.9], { tone: 0.1 })
    // If tone was purely coarse T=0.1, shadows=100 would falsely lift the bright pixel.
    // With edge-stopping, effectiveT blends toward Y=0.9, drastically reducing false shadow lifting.
    const withEdge = applyAdjustments(
      [0.9, 0.9, 0.9],
      { shadows: 100 },
      sharpEdgeCtx
    )
    expect(withEdge[0]).toBeCloseTo(0.9, 1)
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

  it('clarity mid7 evaluates with neutral white balance so lumaOf(mid) is invariant to temperature and tint', () => {
    const grey: Rgb = [0.5, 0.5, 0.5]
    const ctx = context(grey, { mid: 0.5 })
    const { terms: tNeutral } = applyAdjustmentsWithTerms(
      grey,
      { temperature: 0, tint: 0, clarity: 50 },
      ctx
    )
    const { terms: tWarm } = applyAdjustmentsWithTerms(
      grey,
      { temperature: 80, tint: 40, clarity: 50 },
      ctx
    )
    // detailMid = Y - lumaOf(mid). Across temperature/tint changes,
    // detailMid should remain within 0.001 of neutral because mid7 ignores WB
    expect(Math.abs(tWarm.detailMid - tNeutral.detailMid)).toBeLessThan(1e-3)
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

describe('masked adjustments', () => {
  const sample: Rgb = [0.35, 0.5, 0.2]
  const ctx = context(sample, { uv: [0.3, 0.6] })
  const global = { exposure: 0.3, contrast: 20, vignette: -30 }
  const withMasks = (masks: MaskLayer[], adjustments = global, rgb = sample) =>
    applyAdjustmentsWithMasks(
      rgb,
      adjustments,
      masks,
      context(rgb, { uv: [0.3, 0.6] })
    )
  const near = (a: Rgb, b: Rgb, digits = 6) =>
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))

  it('is the global result when there are no masks, or a mask is outside', () => {
    const plain = applyAdjustments(sample, global, ctx)
    near(withMasks([]), plain)
    near(withMasks([{ adjustments: { exposure: 2 }, alpha: 0 }]), plain)
  })

  it.each(grid.slice(0, 40).map((rgb) => [rgb.join(','), rgb] as const))(
    'a mask with no sliders is the identity for %s',
    (_name, rgb) => {
      const plain = applyAdjustments(
        rgb,
        global,
        context(rgb, { uv: [0.3, 0.6] })
      )
      const masked = withMasks([{ adjustments: {}, alpha: 1 }], global, rgb)
      masked.forEach((value, i) => {
        expect(Math.abs(value - plain[i])).toBeLessThan(1 / 255)
      })
    }
  )

  it('adjusts the global result fully where the mask is 1', () => {
    const { out, terms } = applyAdjustmentsWithTerms(sample, global, ctx)
    const local = { exposure: 1, saturation: 30 }
    near(
      withMasks([{ adjustments: local, alpha: 1 }]),
      applyMaskAdjustments(out, local, terms)
    )
  })

  it('brightens with positive exposure and darkens with negative', () => {
    const base = applyAdjustments(sample, global, ctx)
    const lighter = withMasks([{ adjustments: { exposure: 1 }, alpha: 1 }])
    const darker = withMasks([{ adjustments: { exposure: -1 }, alpha: 1 }])
    expect(luma(...lighter)).toBeGreaterThan(luma(...base))
    expect(luma(...darker)).toBeLessThan(luma(...base))
  })

  it('mixes linearly in the mask alpha', () => {
    const local = { exposure: 1, tint: 40 }
    const none = withMasks([{ adjustments: local, alpha: 0 }])
    const all = withMasks([{ adjustments: local, alpha: 1 }])
    const half = withMasks([{ adjustments: local, alpha: 0.5 }])
    near(half, none.map((v, i) => (v + all[i]) / 2) as Rgb)
    const quarter = withMasks([{ adjustments: local, alpha: 0.25 }])
    near(quarter, none.map((v, i) => v + (all[i] - v) * 0.25) as Rgb)
  })

  it('runs masks in recipe order, each on the result of the one before', () => {
    const first = { adjustments: { exposure: 1 }, alpha: 0.6 }
    const second = {
      adjustments: { saturation: -80, contrast: 30 },
      alpha: 0.7
    }
    const { out, terms } = applyAdjustmentsWithTerms(sample, global, ctx)
    const afterFirst = out.map(
      (v, i) =>
        v + (applyMaskAdjustments(out, first.adjustments, terms)[i] - v) * 0.6
    ) as Rgb
    const expected = afterFirst.map(
      (v, i) =>
        v +
        (applyMaskAdjustments(afterFirst, second.adjustments, terms)[i] - v) *
          0.7
    ) as Rgb
    near(withMasks([first, second]), expected)
    // And the order matters: the other way round is not the same colour.
    const swapped = withMasks([second, first])
    expect(
      Math.abs(swapped[0] - expected[0]) + Math.abs(swapped[1] - expected[1])
    ).toBeGreaterThan(1e-3)
  })

  it('adjusts on top of the global adjustments, not instead of them', () => {
    const local = { exposure: 0.5 }
    const withGlobal = withMasks([{ adjustments: local, alpha: 1 }])
    const withoutGlobal = withMasks([{ adjustments: local, alpha: 1 }], {
      exposure: 0,
      contrast: 0,
      vignette: 0
    })
    expect(withGlobal[0]).not.toBeCloseTo(withoutGlobal[0], 3)
    // Same total exposure either way for a flat grey, up to the contrast curve.
    const flat: Rgb = [0.3, 0.3, 0.3]
    const combined = applyAdjustments(flat, { exposure: 0.8 }, context(flat))
    const stacked = applyAdjustmentsWithMasks(
      flat,
      { exposure: 0.3 },
      [{ adjustments: { exposure: 0.5 }, alpha: 1 }],
      context(flat)
    )
    near(stacked, combined, 4)
  })

  it('does not vignette: a mask has no vignette slider and adds none', () => {
    const corner = context(sample, { uv: [0, 0] })
    const centre = context(sample, { uv: [0.5, 0.5] })
    const local = { adjustments: { saturation: 20 }, alpha: 1 }
    const atCorner = applyAdjustmentsWithMasks(sample, {}, [local], corner)
    const atCentre = applyAdjustmentsWithMasks(sample, {}, [local], centre)
    near(atCorner, atCentre)
  })

  it('lifts shadows where the global tone value is dark, not where it is bright', () => {
    const dark: Rgb = [0.1, 0.1, 0.1]
    const lifted = { adjustments: { shadows: 100 }, alpha: 1 }
    // Same pixel, but the wide blur around it is dark (shadows apply) or bright.
    const inShadow = applyAdjustmentsWithMasks(
      dark,
      {},
      [lifted],
      context(dark, { tone: 0.05 })
    )
    const inLight = applyAdjustmentsWithMasks(
      dark,
      {},
      [lifted],
      context(dark, { tone: 0.95 })
    )
    expect(luma(...inShadow)).toBeGreaterThan(luma(...inLight))
    expect(luma(...inShadow)).toBeGreaterThan(luma(...dark) + 0.02)
  })

  it('reuses the global detail terms for texture', () => {
    // A pixel brighter than its neighbourhood has positive detail.
    const edge: Rgb = [0.6, 0.6, 0.6]
    const detailCtx = context(edge, { fine: [0.4, 0.4, 0.4] })
    const flatCtx = context(edge)
    const textured = { adjustments: { texture: 100 }, alpha: 1 }
    const withDetail = applyAdjustmentsWithMasks(
      edge,
      {},
      [textured],
      detailCtx
    )
    const withoutDetail = applyAdjustmentsWithMasks(
      edge,
      {},
      [textured],
      flatCtx
    )
    expect(luma(...withDetail)).toBeGreaterThan(luma(...withoutDetail) + 0.01)
  })

  it('stays inside 0..1', () => {
    const out = withMasks([
      {
        adjustments: { exposure: 5, contrast: 100, saturation: 100 },
        alpha: 1
      },
      { adjustments: { exposure: -5 }, alpha: 0.5 }
    ])
    for (const value of out) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})
