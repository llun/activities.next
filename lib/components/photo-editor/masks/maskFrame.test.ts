import { getMaskFrameSize, getMaskRaster, packChannels } from './maskFrame'
import { createRaster } from './maskRaster'

describe('getMaskFrameSize', () => {
  it('keeps the aspect with a long edge of at most 1024', () => {
    expect(getMaskFrameSize({ width: 4000, height: 3000 })).toEqual({
      width: 1024,
      height: 768
    })
    expect(getMaskFrameSize({ width: 3000, height: 4000 })).toEqual({
      width: 768,
      height: 1024
    })
  })

  it('does not scale a small output up', () => {
    expect(getMaskFrameSize({ width: 300, height: 200 })).toEqual({
      width: 300,
      height: 200
    })
  })

  it('is never empty', () => {
    expect(getMaskFrameSize({ width: 5000, height: 1 })).toEqual({
      width: 1024,
      height: 1
    })
  })
})

describe('packChannels', () => {
  const size = { width: 2, height: 1 }

  it('puts plane i in channel i and leaves the rest zero', () => {
    const frame = packChannels(
      [new Uint8ClampedArray([10, 20]), null, new Uint8ClampedArray([30, 40])],
      size
    )
    expect(frame.size).toEqual(size)
    expect(Array.from(frame.data)).toEqual([10, 0, 30, 0, 20, 0, 40, 0])
  })

  it('ignores planes past the fourth', () => {
    const plane = new Uint8ClampedArray([1, 2])
    const frame = packChannels([plane, plane, plane, plane, plane], size)
    expect(Array.from(frame.data)).toEqual([1, 1, 1, 1, 2, 2, 2, 2])
  })
})

describe('getMaskRaster', () => {
  const subject = createRaster({ width: 2, height: 1 })
  subject.data.set([255, 64])

  it('uses a subject or brush mask own pixels', () => {
    const mask = {
      id: 'aaaaaaaa',
      kind: 'subject' as const,
      points: [],
      feather: 0,
      adjustments: {}
    }
    expect(getMaskRaster(mask, { aaaaaaaa: subject })).toBe(subject)
    expect(getMaskRaster(mask, {})).toBeNull()
  })

  it('makes a background the inverse of its subject', () => {
    const background = {
      id: 'bbbbbbbb',
      kind: 'background' as const,
      of: 'aaaaaaaa',
      points: [],
      feather: 0,
      adjustments: {}
    }
    const raster = getMaskRaster(background, { aaaaaaaa: subject })
    expect(Array.from(raster?.data ?? [])).toEqual([0, 191])
    expect(getMaskRaster(background, {})).toBeNull()
  })
})
