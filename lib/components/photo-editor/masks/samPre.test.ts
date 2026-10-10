import { MAX_MASK_POINTS } from '@/lib/services/medias/edit/recipe'

import {
  SAM_INPUT_SIZE,
  SAM_MEAN,
  SAM_STD,
  getSamResize,
  preprocessSam,
  toSamPrompt
} from './samPre'

describe('getSamResize', () => {
  it.each([
    [
      { width: 4000, height: 3000 },
      { width: 1024, height: 768 }
    ],
    [
      { width: 3000, height: 4000 },
      { width: 768, height: 1024 }
    ],
    [
      { width: 1024, height: 1024 },
      { width: 1024, height: 1024 }
    ],
    [
      { width: 512, height: 256 },
      { width: 1024, height: 512 }
    ],
    [
      { width: 10000, height: 3 },
      { width: 1024, height: 1 }
    ]
  ])('scales %j so the long edge is 1024', (source, expected) => {
    expect(getSamResize(source)).toEqual(expected)
  })
})

describe('preprocessSam', () => {
  const resized = { width: 4, height: 2 }
  const rgba = new Uint8ClampedArray(resized.width * resized.height * 4)
  for (let i = 0; i < resized.width * resized.height; i += 1) {
    rgba.set([255, 128, 0, 255], i * 4)
  }
  const tensor = preprocessSam(rgba, resized)
  const plane = SAM_INPUT_SIZE * SAM_INPUT_SIZE

  it('has the shape [1, 3, 1024, 1024]', () => {
    expect(tensor).toBeInstanceOf(Float32Array)
    expect(tensor).toHaveLength(3 * plane)
  })

  it('rescales by 1/255 and normalizes per channel with mean and std', () => {
    expect(tensor[0]).toBeCloseTo((1 - SAM_MEAN[0]) / SAM_STD[0], 5)
    expect(tensor[plane]).toBeCloseTo((128 / 255 - SAM_MEAN[1]) / SAM_STD[1], 5)
    expect(tensor[2 * plane]).toBeCloseTo((0 - SAM_MEAN[2]) / SAM_STD[2], 5)
  })

  it('lays rows out with a stride of 1024', () => {
    const second = new Uint8ClampedArray(rgba)
    second.set([0, 0, 0, 255], 4 * resized.width) // pixel (0, 1)
    const out = preprocessSam(second, resized)
    expect(out[SAM_INPUT_SIZE]).toBeCloseTo((0 - SAM_MEAN[0]) / SAM_STD[0], 5)
    expect(out[SAM_INPUT_SIZE + 1]).toBeCloseTo(tensor[1], 6)
  })

  it('pads the right and the bottom with zeros after normalizing', () => {
    expect(tensor[resized.width]).toBe(0)
    expect(tensor[SAM_INPUT_SIZE - 1]).toBe(0)
    expect(tensor[resized.height * SAM_INPUT_SIZE]).toBe(0)
    expect(tensor[3 * plane - 1]).toBe(0)
    // And the picture itself is not zero.
    expect(tensor[resized.width - 1]).not.toBe(0)
  })

  it('does not use the alpha channel', () => {
    const transparent = new Uint8ClampedArray(rgba)
    for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0
    expect(preprocessSam(transparent, resized)[0]).toBe(tensor[0])
  })

  it('rejects pixels that do not match the size, or a size over 1024', () => {
    expect(() => preprocessSam(new Uint8ClampedArray(12), resized)).toThrow()
    expect(() =>
      preprocessSam(new Uint8ClampedArray(1025 * 4), { width: 1025, height: 1 })
    ).toThrow()
  })
})

describe('toSamPrompt', () => {
  it('scales 0..1 points to pixels of the resized picture', () => {
    const prompt = toSamPrompt(
      [
        { x: 0.5, y: 0.25, label: 1 },
        { x: 1, y: 0, label: 0 }
      ],
      { width: 1024, height: 768 }
    )
    expect(Array.from(prompt.coordinates)).toEqual([512, 192, 1024, 0])
    expect(prompt.labels).toEqual([1, 0])
  })

  it('handles the most points a mask can hold', () => {
    const points = Array.from({ length: MAX_MASK_POINTS }, (_, i) => ({
      x: i / MAX_MASK_POINTS,
      y: 0.5,
      label: (i % 2) as 0 | 1
    }))
    const prompt = toSamPrompt(points, { width: 1024, height: 1024 })
    expect(prompt.coordinates).toHaveLength(MAX_MASK_POINTS * 2)
    expect(prompt.labels).toHaveLength(MAX_MASK_POINTS)
  })
})
