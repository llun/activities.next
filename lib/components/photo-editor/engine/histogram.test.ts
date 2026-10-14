import { computeHistogram, computeStats } from './histogram'

const pixels = (colours: Array<[number, number, number]>, repeat = 1) => {
  const data = new Uint8ClampedArray(colours.length * repeat * 4)
  for (let n = 0; n < repeat; n += 1) {
    colours.forEach(([r, g, b], i) => {
      const at = (n * colours.length + i) * 4
      data[at] = r
      data[at + 1] = g
      data[at + 2] = b
      data[at + 3] = 255
    })
  }
  return data
}

describe('computeStats', () => {
  it('measures a flat grey', () => {
    const data = pixels([[128, 128, 128]], 100)
    const stats = computeStats(data, 10, 10)
    expect(stats.sd).toBeCloseTo(0, 3)
    expect(stats.p005).toBeCloseTo(stats.p995, 2)
    expect(stats.p50).toBeCloseTo(128 / 255, 1)
    expect(stats.meanChroma).toBe(0)
    expect(stats.midtone.r).toBeCloseTo(128 / 255, 3)
    expect(stats.meanLinear).toBeCloseTo(0.2158, 2)
    expect(stats.neutralMidtone.weight).toBe(1)
    expect(stats.neutralMidtone.r).toBeCloseTo(0.2158, 2)
  })

  it('gives percentiles and fractions for black and white halves', () => {
    const data = pixels(
      [
        [0, 0, 0],
        [255, 255, 255]
      ],
      200
    )
    const stats = computeStats(data, 20, 20)
    expect(stats.p005).toBeLessThan(0.01)
    expect(stats.p50).toBeGreaterThanOrEqual(0)
    expect(stats.p995).toBeGreaterThan(0.99)
    expect(stats.fractionHigh).toBeCloseTo(0.5, 5)
    expect(stats.fractionLow).toBeCloseTo(0.5, 5)
    expect(stats.sd).toBeCloseTo(0.5, 1)
    expect(stats.midtone).toEqual({ r: 0, g: 0, b: 0 })
    expect(stats.neutralMidtone.weight).toBe(0)
  })

  it('measures chroma', () => {
    const stats = computeStats(pixels([[255, 0, 0]], 4), 2, 2)
    expect(stats.meanChroma).toBe(1)
    expect(stats.neutralMidtone.weight).toBe(0)
  })

  it('handles an empty image', () => {
    expect(computeStats(new Uint8ClampedArray(0), 0, 0).meanLinear).toBe(0)
    expect(
      computeStats(new Uint8ClampedArray(0), 0, 0).neutralMidtone.weight
    ).toBe(0)
  })
})

describe('computeHistogram', () => {
  it('bins sum to the pixel count on every channel', () => {
    const data = pixels(
      [
        [0, 10, 255],
        [100, 200, 30],
        [255, 255, 255]
      ],
      10
    )
    const histogram = computeHistogram(data, 30, 1, 64)
    expect(histogram.bins).toBe(64)
    for (const channel of [
      histogram.r,
      histogram.g,
      histogram.b,
      histogram.luma
    ]) {
      expect(channel).toHaveLength(64)
      expect(channel.reduce((sum, n) => sum + n, 0)).toBe(30)
    }
    expect(histogram.r[0]).toBe(10)
    expect(histogram.b[63]).toBe(20)
  })

  it('supports other bin counts', () => {
    const histogram = computeHistogram(pixels([[255, 255, 255]]), 1, 1, 8)
    expect(histogram.luma[7]).toBe(1)
  })

  it('defaults to 128 bins', () => {
    const histogram = computeHistogram(pixels([[0, 128, 255]], 4), 4, 1)
    expect(histogram.bins).toBe(128)
    expect(histogram.r).toHaveLength(128)
    expect(histogram.g[64]).toBe(4)
    expect(histogram.b[127]).toBe(4)
  })

  it.each([
    {
      description: 'pure black clips every channel in the shadows',
      rgb: [0, 0, 0],
      low: { r: 3, g: 3, b: 3 },
      high: { r: 0, g: 0, b: 0 }
    },
    {
      description: 'pure white clips every channel in the highlights',
      rgb: [255, 255, 255],
      low: { r: 0, g: 0, b: 0 },
      high: { r: 3, g: 3, b: 3 }
    },
    {
      description: 'pure red clips red high and green/blue low',
      rgb: [255, 0, 0],
      low: { r: 0, g: 3, b: 3 },
      high: { r: 3, g: 0, b: 0 }
    },
    {
      description: 'near-extreme values are not clipped',
      rgb: [1, 254, 128],
      low: { r: 0, g: 0, b: 0 },
      high: { r: 0, g: 0, b: 0 }
    }
  ])('counts exact clipping: $description', ({ rgb, low, high }) => {
    const histogram = computeHistogram(
      pixels([rgb as [number, number, number]], 3),
      3,
      1
    )
    expect(histogram.total).toBe(3)
    expect(histogram.clipLow).toEqual(low)
    expect(histogram.clipHigh).toEqual(high)
  })
})
