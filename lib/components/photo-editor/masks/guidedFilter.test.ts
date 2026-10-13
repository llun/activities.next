import { refineMaskWithGuide } from './guidedFilter'

describe('refineMaskWithGuide', () => {
  it('snaps a blurry/shifted mask boundary to a sharp guide edge', () => {
    const width = 30
    const height = 10
    const count = width * height

    // Guide image: left 15 columns are dark (0), right 15 columns are bright white (255)
    const guideRgba = new Uint8ClampedArray(count * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4
        const val = x >= 15 ? 255 : 0
        guideRgba[idx] = val
        guideRgba[idx + 1] = val
        guideRgba[idx + 2] = val
        guideRgba[idx + 3] = 255
      }
    }

    // Coarse mask has a wide blurry boundary centered around x = 15 (from x = 11 to x = 19)
    const coarseMask = new Uint8ClampedArray(count)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let val = 0
        if (x >= 19) val = 255
        else if (x >= 11) val = ((x - 11) / 8) * 255
        coarseMask[y * width + x] = Math.round(val)
      }
    }

    const refined = refineMaskWithGuide(
      coarseMask,
      guideRgba,
      width,
      height,
      4,
      0.002
    )

    const row = Array.from({ length: width }, (_, x) => refined[5 * width + x])
    expect(row[5]).toBe(0)
    expect(row[25]).toBe(255)
    // Coarse mask had smooth slope (difference of ~32 between 14 and 15),
    // but refined mask has sharp step across the guide edge at x = 15
    expect(row[15] - row[14]).toBeGreaterThan(100)
    expect(row[14]).toBeLessThan(80)
    expect(row[15]).toBeGreaterThan(180)
  })

  it('keeps solid interior at 255 and solid exterior at 0', () => {
    const width = 20
    const height = 20
    const count = width * height
    const guideRgba = new Uint8ClampedArray(count * 4).fill(128)
    const mask = new Uint8ClampedArray(count)

    // Center 10x10 is 255, outside is 0
    for (let y = 5; y < 15; y += 1) {
      for (let x = 5; x < 15; x += 1) {
        mask[y * width + x] = 255
      }
    }

    const refined = refineMaskWithGuide(mask, guideRgba, width, height, 2)
    // Center point should be 255
    expect(refined[10 * width + 10]).toBe(255)
    // Corner should be 0
    expect(refined[0]).toBe(0)
  })
})
