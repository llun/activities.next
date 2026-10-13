import { boxToPromptPoints, detectSalientPoints } from './saliency'

describe('detectSalientPoints', () => {
  it('falls back to focusToPoint on a uniform/flat image', () => {
    const width = 32
    const height = 32
    const rgba = new Uint8ClampedArray(width * height * 4).fill(128)
    const points = detectSalientPoints(rgba, width, height, null)
    expect(points).toHaveLength(1)
    expect(points[0]).toEqual({ x: 0.5, y: 0.5, label: 1 })

    const withFocus = detectSalientPoints(rgba, width, height, {
      x: 0.2,
      y: 0.4
    })
    expect(withFocus).toHaveLength(1)
    expect(withFocus[0].x).toBeCloseTo(0.6, 2)
    expect(withFocus[0].y).toBeCloseTo(0.3, 2)
    expect(withFocus[0].label).toBe(1)
  })

  it('detects an off-center bright object on a dark background', () => {
    const width = 48
    const height = 48
    const rgba = new Uint8ClampedArray(width * height * 4).fill(20)

    // Put a bright red object at x: 28..38, y: 20..30
    for (let y = 20; y < 30; y += 1) {
      for (let x = 28; x < 38; x += 1) {
        const idx = (y * width + x) * 4
        rgba[idx] = 240
        rgba[idx + 1] = 40
        rgba[idx + 2] = 40
        rgba[idx + 3] = 255
      }
    }

    const points = detectSalientPoints(rgba, width, height)
    expect(points.length).toBeGreaterThanOrEqual(1)

    // Primary point should be positive (label: 1) and located around the object
    const primary = points[0]
    expect(primary.label).toBe(1)
    expect(primary.x).toBeGreaterThan(0.55)
    expect(primary.x).toBeLessThan(0.85)
    expect(primary.y).toBeGreaterThan(0.4)
    expect(primary.y).toBeLessThan(0.7)

    // Negative points should have label: 0
    const negatives = points.filter((p) => p.label === 0)
    expect(negatives.length).toBeGreaterThan(0)
    for (const neg of negatives) {
      expect([0.06, 0.94]).toContain(neg.x)
      expect([0.06, 0.94]).toContain(neg.y)
    }
  })

  it('biases toward focus coordinates when focus is provided', () => {
    const width = 48
    const height = 48
    const rgba = new Uint8ClampedArray(width * height * 4).fill(30)

    // Two bright spots: one at top-left, one at bottom-right
    for (let y = 10; y < 18; y += 1) {
      for (let x = 10; x < 18; x += 1) {
        const idx = (y * width + x) * 4
        rgba[idx] = 230
        rgba[idx + 1] = 230
        rgba[idx + 2] = 230
      }
    }
    for (let y = 30; y < 38; y += 1) {
      for (let x = 30; x < 38; x += 1) {
        const idx = (y * width + x) * 4
        rgba[idx] = 230
        rgba[idx + 1] = 230
        rgba[idx + 2] = 230
      }
    }

    // Focus on top-left (-0.4, 0.4 in focus coords: x ~ 0.3, y ~ 0.3)
    const points = detectSalientPoints(rgba, width, height, { x: -0.4, y: 0.4 })
    expect(points[0].x).toBeLessThan(0.5)
    expect(points[0].y).toBeLessThan(0.5)
  })
})

describe('boxToPromptPoints', () => {
  it('converts a normalized bounding box to positive and negative points', () => {
    const box = { x0: 0.2, y0: 0.3, x1: 0.6, y1: 0.7 }
    const points = boxToPromptPoints(box)

    const positives = points.filter((p) => p.label === 1)
    const negatives = points.filter((p) => p.label === 0)

    expect(positives).toHaveLength(5)
    expect(negatives).toHaveLength(4)

    // Center point
    expect(positives[0].x).toBeCloseTo(0.4, 3)
    expect(positives[0].y).toBeCloseTo(0.5, 3)

    // Inner points are all strictly inside the bounding box
    for (const pos of positives) {
      expect(pos.x).toBeGreaterThanOrEqual(0.2)
      expect(pos.x).toBeLessThanOrEqual(0.6)
      expect(pos.y).toBeGreaterThanOrEqual(0.3)
      expect(pos.y).toBeLessThanOrEqual(0.7)
    }

    // Outer negative points are strictly outside the bounding box
    for (const neg of negatives) {
      const isOutside = neg.x < 0.2 || neg.x > 0.6 || neg.y < 0.3 || neg.y > 0.7
      expect(isOutside).toBe(true)
      expect(neg.x).toBeGreaterThanOrEqual(0.01)
      expect(neg.x).toBeLessThanOrEqual(0.99)
      expect(neg.y).toBeGreaterThanOrEqual(0.01)
      expect(neg.y).toBeLessThanOrEqual(0.99)
    }
  })

  it('handles inverted coordinate inputs (x0 > x1, y0 > y1)', () => {
    const box = { x0: 0.7, y0: 0.8, x1: 0.3, y1: 0.2 }
    const points = boxToPromptPoints(box)
    const positives = points.filter((p) => p.label === 1)
    expect(positives[0].x).toBeCloseTo(0.5, 3)
    expect(positives[0].y).toBeCloseTo(0.5, 3)
  })

  it('omits negative corner points that would be clamped inside a box touching the image edge', () => {
    const box = { x0: 0, y0: 0, x1: 0.5, y1: 0.5 }
    const points = boxToPromptPoints(box)
    const negatives = points.filter((p) => p.label === 0)
    // Top-left corner (0.01, 0.01) falls inside [0, 0.5] x [0, 0.5], so it must be omitted
    expect(negatives).toHaveLength(3)
    for (const neg of negatives) {
      const isOutside = neg.x < 0 || neg.x > 0.5 || neg.y < 0 || neg.y > 0.5
      expect(isOutside).toBe(true)
    }
  })
})
