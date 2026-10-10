import { containSize, fitLongEdge, getPreviewSizes } from './previewSize'

describe('previewSize', () => {
  it('fits the long edge without upscaling', () => {
    expect(fitLongEdge({ width: 4000, height: 2000 }, 1000)).toEqual({
      width: 1000,
      height: 500
    })
    expect(fitLongEdge({ width: 300, height: 200 }, 1000)).toEqual({
      width: 300,
      height: 200
    })
  })

  it('contains an aspect in a box', () => {
    expect(containSize(2, { width: 400, height: 400 })).toEqual({
      width: 400,
      height: 200
    })
    expect(containSize(0.5, { width: 400, height: 400 })).toEqual({
      width: 200,
      height: 400
    })
    expect(containSize(1, { width: 0, height: 10 })).toEqual({
      width: 0,
      height: 0
    })
  })

  it('applies the pixel ratio, the 2048 cap and the output size', () => {
    const sizes = getPreviewSizes(
      { width: 4000, height: 3000 },
      { width: 1200, height: 900 },
      2
    )
    expect(sizes.css).toEqual({ width: 1200, height: 900 })
    expect(sizes.pixels).toEqual({ width: 2048, height: 1536 })
    const small = getPreviewSizes(
      { width: 640, height: 480 },
      { width: 1200, height: 900 },
      2
    )
    expect(small.pixels).toEqual({ width: 640, height: 480 })
  })
})
