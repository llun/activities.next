import {
  SAM_MASK_COUNT,
  SAM_MASK_SIDE,
  pickBestMask,
  postprocessSam
} from './samPost'

const PLANE = SAM_MASK_SIDE * SAM_MASK_SIDE

/** The decoder's pipeline written out in full: upscale to 1024, crop, threshold. */
const reference = (
  logits: ArrayLike<number>,
  offset: number,
  width: number,
  height: number
) => {
  const side = SAM_MASK_SIDE
  const sample = (x: number, y: number) => {
    const fx = Math.min(side - 1, Math.max(0, (x + 0.5) / 4 - 0.5))
    const fy = Math.min(side - 1, Math.max(0, (y + 0.5) / 4 - 0.5))
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const x1 = Math.min(side - 1, x0 + 1)
    const y1 = Math.min(side - 1, y0 + 1)
    const tx = fx - x0
    const ty = fy - y0
    const at = (xx: number, yy: number) => logits[offset + yy * side + xx]
    return (
      (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
      (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
    )
  }
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = sample(x, y) > 0 ? 255 : 0
    }
  }
  return out
}

const randomLogits = (planes: number) => {
  let seed = 7
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
  return Float32Array.from({ length: planes * PLANE }, () => next() * 8 - 4)
}

describe('pickBestMask', () => {
  it.each([
    [[0.1, 0.9, 0.5], 1],
    [[0.7, 0.2, 0.3], 0],
    [[0.1, 0.2, 0.95], 2],
    [[0.5, 0.5, 0.5], 0]
  ])('picks the highest IoU of %j (index %i)', (scores, expected) => {
    expect(pickBestMask(scores)).toBe(expected)
  })
})

describe('postprocessSam', () => {
  it('returns one 0 or 255 byte per mask pixel', () => {
    const logits = randomLogits(SAM_MASK_COUNT)
    const out = postprocessSam([0.2, 0.8, 0.5], logits, {
      width: 300,
      height: 200
    })
    expect(out).toHaveLength(300 * 200)
    expect(new Set(out)).toEqual(new Set([0, 255]))
  })

  it('uses the plane with the best IoU, not the first', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    logits.fill(-5, 0, PLANE) // plane 0: all outside
    logits.fill(5, PLANE, 2 * PLANE) // plane 1: all inside
    logits.fill(-5, 2 * PLANE) // plane 2: all outside
    const size = { width: 64, height: 48 }
    expect(new Set(postprocessSam([0.1, 0.9, 0.3], logits, size))).toEqual(
      new Set([255])
    )
    expect(new Set(postprocessSam([0.9, 0.1, 0.3], logits, size))).toEqual(
      new Set([0])
    )
  })

  it('thresholds at 0: a logit of exactly 0 is outside', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    expect(
      new Set(postprocessSam([1, 0, 0], logits, { width: 8, height: 8 }))
    ).toEqual(new Set([0]))
    logits.fill(0.001, 0, PLANE)
    expect(
      new Set(postprocessSam([1, 0, 0], logits, { width: 8, height: 8 }))
    ).toEqual(new Set([255]))
  })

  it.each([
    [{ width: 1024, height: 768 }],
    [{ width: 300, height: 1024 }],
    [{ width: 7, height: 5 }]
  ])(
    'equals upscaling to 1024 and cropping to %j (the padding is cut)',
    (resized) => {
      const logits = randomLogits(SAM_MASK_COUNT)
      const best = 2
      const out = postprocessSam([0.1, 0.4, 0.9], logits, resized)
      expect(Array.from(out)).toEqual(
        Array.from(
          reference(logits, best * PLANE, resized.width, resized.height)
        )
      )
    }
  )

  it('crops the padding: a half-width picture sees only the left half', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    // The left half of the 256 grid is inside, the right half outside.
    for (let y = 0; y < SAM_MASK_SIDE; y += 1) {
      for (let x = 0; x < SAM_MASK_SIDE; x += 1) {
        logits[y * SAM_MASK_SIDE + x] = x < 128 ? 3 : -3
      }
    }
    const out = postprocessSam([1, 0, 0], logits, { width: 512, height: 512 })
    // 512 px wide at the top-left of the 1024 plane: all in the inside half.
    expect(new Set(out)).toEqual(new Set([255]))
  })

  it('scales to a different mask size', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE).fill(2)
    const out = postprocessSam(
      [1, 0, 0],
      logits,
      { width: 1024, height: 768 },
      { width: 100, height: 75 }
    )
    expect(out).toHaveLength(7500)
    expect(new Set(out)).toEqual(new Set([255]))
  })

  it('rejects an output that is too short', () => {
    expect(() =>
      postprocessSam([1, 0, 0], new Float32Array(10), { width: 4, height: 4 })
    ).toThrow()
  })
})
