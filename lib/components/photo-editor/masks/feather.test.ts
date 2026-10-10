import { featherSigma, gaussianBlur } from './feather'

describe('featherSigma', () => {
  it.each([
    [0, 1024, 0],
    [100, 1024, 20.48],
    [50, 1000, 10],
    [12, 1000, 2.4]
  ])('feather %i on a %i px long edge has sigma %f', (feather, edge, sigma) => {
    expect(featherSigma(feather, edge)).toBeCloseTo(sigma, 6)
  })

  it('clamps feather to 0..100', () => {
    expect(featherSigma(-5, 1000)).toBe(0)
    expect(featherSigma(500, 1000)).toBeCloseTo(20, 6)
  })
})

describe('gaussianBlur', () => {
  const step = (width: number, height: number) =>
    Float32Array.from({ length: width * height }, (_, i) =>
      i % width < width / 2 ? 0 : 255
    )

  it('leaves the data alone with sigma 0', () => {
    const data = step(16, 4)
    expect(Array.from(gaussianBlur(data, 16, 4, 0))).toEqual(Array.from(data))
  })

  it('keeps a flat field flat, edges included', () => {
    const out = gaussianBlur(new Uint8Array(100).fill(200), 10, 10, 2)
    for (const value of out) expect(value).toBeCloseTo(200, 3)
  })

  it('softens a step symmetrically around the edge', () => {
    const out = gaussianBlur(step(64, 3), 64, 3, 3)
    const row = Array.from(out.subarray(0, 64))
    expect(row[31]).toBeGreaterThan(row[20])
    expect(row[32]).toBeLessThan(row[43])
    expect(row[31] + row[32]).toBeCloseTo(255, 2)
    expect(row[0]).toBeCloseTo(0, 1)
    expect(row[63]).toBeCloseTo(255, 1)
  })

  it('keeps the total mass of an interior blob', () => {
    const data = new Float32Array(41 * 41)
    data[20 * 41 + 20] = 1000
    const out = gaussianBlur(data, 41, 41, 2)
    expect(out.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1000, 1)
  })
})
