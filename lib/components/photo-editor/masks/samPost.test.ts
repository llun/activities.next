import {
  SAM_MASK_COUNT,
  SAM_MASK_SIDE,
  pickBestMask,
  postprocessSam
} from './samPost'

const PLANE = SAM_MASK_SIDE * SAM_MASK_SIDE

/** The decoder's pipeline written out in full: upscale to 1024, crop, logistic ramp. */
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
  const out = new Uint8ClampedArray(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = sample(x, y)
      out[y * width + x] =
        v >= 3
          ? 255
          : v <= -3
            ? 0
            : Math.round((1 / (1 + Math.exp(-v * 2.2))) * 255)
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
  ])(
    'picks the highest IoU of %j (index %i) with 1 argument',
    (scores, expected) => {
      expect(pickBestMask(scores)).toBe(expected)
    }
  )

  it('prefers whole-object mask (index 2) when its IoU is close to max', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    // Mask 0 (part/button): 1% area, IoU = 0.90
    logits.fill(-5, 0, PLANE)
    logits.fill(5, 0, Math.round(0.01 * PLANE))

    // Mask 2 (whole object): 25% area, IoU = 0.86 (within 0.12 of 0.90)
    logits.fill(-5, 2 * PLANE, 3 * PLANE)
    logits.fill(5, 2 * PLANE, 2 * PLANE + Math.round(0.25 * PLANE))

    const size = { width: 1024, height: 1024 }
    // Mask 2 should get +0.08 bonus (0.86 + 0.08 = 0.94 > 0.90) and win
    expect(pickBestMask([0.9, 0.5, 0.86], logits, size)).toBe(2)
  })

  it('rejects degenerate masks (e.g. tiny button or almost entirely full)', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    // Mask 0 has degenerate area fraction (< 0.004)
    logits.fill(-5, 0, PLANE)
    logits.fill(5, 0, 10) // 10 pixels / 65536 << 0.004

    // Mask 1 has valid area (15%) with slightly lower raw IoU
    logits.fill(-5, PLANE, 2 * PLANE)
    logits.fill(5, PLANE, PLANE + Math.round(0.15 * PLANE))

    const size = { width: 1024, height: 1024 }
    // Mask 0 has raw IoU 0.95, Mask 1 has raw IoU 0.85
    // Mask 0 gets penalized by -0.5 -> 0.45, so Mask 1 wins
    expect(pickBestMask([0.95, 0.85, 0.2], logits, size)).toBe(1)
  })
})

describe('postprocessSam', () => {
  it('returns smooth logistic values on intermediate logits', () => {
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE)
    // Logit 0 maps to exactly 128 (Math.round(0.5 * 255) = 128)
    logits.fill(0, 0, PLANE)
    const out = postprocessSam([1, 0, 0], logits, { width: 4, height: 4 })
    expect(out[0]).toBe(128)
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
        logits[y * SAM_MASK_SIDE + x] = x < 128 ? 5 : -5
      }
    }
    const out = postprocessSam([1, 0, 0], logits, { width: 512, height: 512 })
    // 512 px wide at the top-left of the 1024 plane: inside the positive half
    expect(out.every((b) => b >= 240)).toBe(true)
    // Pixels away from the right boundary are fully solid (255)
    expect(out[0]).toBe(255)
  })

  it('integrates with guided filter when guideRgba is provided', () => {
    const size = { width: 40, height: 10 }
    const logits = new Float32Array(SAM_MASK_COUNT * PLANE).fill(-5)
    // Coarse edge in SAM mask around x = 3 in 256 grid (x = 12 in 40-wide image)
    for (let y = 0; y < SAM_MASK_SIDE; y += 1) {
      for (let x = 0; x < SAM_MASK_SIDE; x += 1) {
        if (x < 3) logits[y * SAM_MASK_SIDE + x] = 5
      }
    }
    const guideRgba = new Uint8ClampedArray(size.width * size.height * 4)
    // Guide has sharp edge at x = 12
    for (let y = 0; y < size.height; y += 1) {
      for (let x = 0; x < size.width; x += 1) {
        const idx = (y * size.width + x) * 4
        const val = x < 12 ? 255 : 0
        guideRgba[idx] = val
        guideRgba[idx + 1] = val
        guideRgba[idx + 2] = val
        guideRgba[idx + 3] = 255
      }
    }
    const out = postprocessSam([1, 0, 0], logits, size, size, guideRgba)
    expect(out).toHaveLength(size.width * size.height)
    expect(out[0]).toBe(255)
    expect(out[size.width - 1]).toBe(0)
  })

  it('rejects an output that is too short', () => {
    expect(() =>
      postprocessSam([1, 0, 0], new Float32Array(10), { width: 4, height: 4 })
    ).toThrow()
  })
})
