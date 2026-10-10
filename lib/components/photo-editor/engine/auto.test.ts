import { computeAuto } from './auto'
import { computeStats } from './histogram'

const image = (
  fill: (index: number) => [number, number, number],
  count = 400
) => {
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i += 1) {
    const [r, g, b] = fill(i)
    data[i * 4] = r
    data[i * 4 + 1] = g
    data[i * 4 + 2] = b
    data[i * 4 + 3] = 255
  }
  return computeStats(data, 20, count / 20)
}

// A ramp from `low` to `high` grey, with an optional per channel multiplier.
const ramp = (
  low: number,
  high: number,
  tint: [number, number, number] = [1, 1, 1]
) =>
  image((i) => {
    const v = low + ((high - low) * i) / 399
    return [
      Math.min(255, v * tint[0]),
      Math.min(255, v * tint[1]),
      Math.min(255, v * tint[2])
    ]
  })

describe('computeAuto', () => {
  it('brightens a dark photo', () => {
    const auto = computeAuto(ramp(2, 90))
    expect(auto.exposure).toBeGreaterThan(0)
    expect(auto.exposure).toBeLessThanOrEqual(2)
    expect(auto.whites).toBeGreaterThan(0)
    expect(auto.shadows).toBeGreaterThan(0)
  })

  it('darkens a bright photo and recovers highlights', () => {
    const auto = computeAuto(ramp(180, 255))
    expect(auto.exposure).toBeLessThan(0)
    expect(auto.highlights).toBeLessThan(0)
    expect(auto.highlights).toBeGreaterThanOrEqual(-60)
  })

  it('adds contrast to a flat photo', () => {
    const auto = computeAuto(ramp(110, 150))
    expect(auto.contrast).toBeGreaterThan(0)
    expect(auto.contrast).toBeLessThanOrEqual(30)
  })

  it('takes contrast off a harsh photo', () => {
    const harsh = image((i) => (i % 2 === 0 ? [0, 0, 0] : [255, 255, 255]))
    const auto = computeAuto(harsh)
    expect(auto.contrast).toBeLessThan(0)
    expect(auto.contrast).toBeGreaterThanOrEqual(-20)
  })

  it('lifts shadows and darkens highlights when both ends clip', () => {
    const clipped = image((i) => (i % 2 === 0 ? [0, 0, 0] : [255, 255, 255]))
    const auto = computeAuto(clipped)
    expect(auto.shadows).toBeGreaterThanOrEqual(10)
    expect(auto.shadows).toBeLessThanOrEqual(50)
    expect(auto.highlights).toBeLessThanOrEqual(-10)
  })

  it('cools a warm cast', () => {
    const auto = computeAuto(ramp(60, 200, [1.2, 1, 0.8]))
    expect(auto.temperature).toBeLessThan(0)
    expect(auto.temperature).toBeGreaterThanOrEqual(-30)
  })

  it('warms a cool cast', () => {
    expect(
      computeAuto(ramp(60, 200, [0.8, 1, 1.2])).temperature
    ).toBeGreaterThan(0)
  })

  it('adds vibrance to a muted photo and none to a vivid one', () => {
    expect(computeAuto(ramp(60, 200)).vibrance).toBe(20)
    const vivid = image((i) => [i % 2 ? 255 : 0, i % 3 ? 0 : 255, 128])
    expect(computeAuto(vivid).vibrance).toBe(0)
  })

  it('zeroes tiny values and leaves a balanced photo almost alone', () => {
    const balanced = image((i) => {
      const v = 15 + (225 * i) / 399
      return [v, v, v]
    })
    const auto = computeAuto(balanced)
    for (const [key, value] of Object.entries(auto)) {
      if (value === 0) continue
      expect(Math.abs(value)).toBeGreaterThanOrEqual(
        key === 'exposure' ? 0.05 : 3
      )
    }
    expect(Math.abs(auto.exposure)).toBeLessThanOrEqual(0.6)
    expect(auto.temperature).toBe(0)
    expect(auto.tint).toBe(0)
  })

  it('zeroes values the rules leave under the threshold', () => {
    const auto = computeAuto({
      meanLinear: 0.18,
      p005: 0.03,
      p995: 0.97,
      sd: 0.21,
      fractionHigh: 0,
      fractionLow: 0,
      midtone: { r: 0.5, g: 0.5, b: 0.5 },
      meanChroma: 0.4
    })
    expect(auto).toEqual({
      exposure: 0,
      contrast: 0,
      highlights: 0,
      shadows: 0,
      whites: 0,
      blacks: 0,
      temperature: 0,
      tint: 0,
      vibrance: 0
    })
  })

  it('returns whole numbers except exposure', () => {
    const auto = computeAuto(ramp(2, 90, [1.1, 1, 0.9]))
    for (const [key, value] of Object.entries(auto)) {
      if (key !== 'exposure') expect(Number.isInteger(value)).toBe(true)
    }
    expect(
      Math.abs(auto.exposure * 20 - Math.round(auto.exposure * 20))
    ).toBeLessThan(1e-6)
  })

  it('always returns every key it owns', () => {
    expect(Object.keys(computeAuto(ramp(0, 255))).sort()).toEqual(
      [
        'blacks',
        'contrast',
        'exposure',
        'highlights',
        'shadows',
        'temperature',
        'tint',
        'vibrance',
        'whites'
      ].sort()
    )
  })
})
