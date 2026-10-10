import { brushRadiusInRaster, paintStroke } from './brushRaster'
import { createRaster } from './maskRaster'

const at = (raster: ReturnType<typeof createRaster>, x: number, y: number) =>
  raster.data[y * raster.width + x]

describe('paintStroke', () => {
  it('paints a round dab: inside is 255, outside is untouched', () => {
    const raster = createRaster({ width: 40, height: 40 })
    paintStroke(raster, { x: 20, y: 20 }, { x: 20, y: 20 }, 8, 'add')
    expect(at(raster, 20, 20)).toBe(255)
    expect(at(raster, 25, 20)).toBe(255)
    expect(at(raster, 20, 14)).toBe(255)
    expect(at(raster, 20, 5)).toBe(0)
    expect(at(raster, 31, 20)).toBe(0)
    // The corner of the bounding box is outside the circle.
    expect(at(raster, 27, 27)).toBe(0)
  })

  it('gives the edge a one pixel soft falloff', () => {
    const raster = createRaster({ width: 40, height: 40 })
    paintStroke(raster, { x: 20.25, y: 20.5 }, { x: 20.25, y: 20.5 }, 8, 'add')
    const edge = at(raster, 28, 20)
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })

  it('joins two points with a continuous stroke', () => {
    const raster = createRaster({ width: 100, height: 20 })
    paintStroke(raster, { x: 10, y: 10 }, { x: 90, y: 10 }, 3, 'add')
    for (let x = 10; x <= 90; x += 1) expect(at(raster, x, 10)).toBe(255)
    expect(at(raster, 50, 2)).toBe(0)
  })

  it('erases what a stroke covers and leaves the rest', () => {
    const raster = createRaster({ width: 40, height: 40 }, 255)
    paintStroke(raster, { x: 20, y: 20 }, { x: 20, y: 20 }, 6, 'erase')
    expect(at(raster, 20, 20)).toBe(0)
    expect(at(raster, 2, 2)).toBe(255)
  })

  it('never lowers a pixel when adding, or raises one when erasing', () => {
    const raster = createRaster({ width: 20, height: 20 }, 255)
    paintStroke(raster, { x: 10, y: 10 }, { x: 10, y: 10 }, 5, 'add')
    expect(new Set(raster.data)).toEqual(new Set([255]))
    const empty = createRaster({ width: 20, height: 20 })
    paintStroke(empty, { x: 10, y: 10 }, { x: 10, y: 10 }, 5, 'erase')
    expect(new Set(empty.data)).toEqual(new Set([0]))
  })

  it('is clipped at the edge of the raster', () => {
    const raster = createRaster({ width: 10, height: 10 })
    paintStroke(raster, { x: -5, y: -5 }, { x: 3, y: 3 }, 6, 'add')
    expect(at(raster, 0, 0)).toBe(255)
    expect(raster.data).toHaveLength(100)
    paintStroke(raster, { x: 50, y: 50 }, { x: 60, y: 60 }, 4, 'add')
  })

  it('paints at least the pixel under a tiny brush', () => {
    const raster = createRaster({ width: 10, height: 10 })
    paintStroke(raster, { x: 5.5, y: 5.5 }, { x: 5.5, y: 5.5 }, 0.2, 'add')
    expect(at(raster, 5, 5)).toBe(255)
  })
})

describe('brushRadiusInRaster', () => {
  it('turns a brush size in CSS pixels into raster pixels', () => {
    // 40 px brush, one source pixel is half a CSS pixel, the raster is a
    // quarter of the source.
    expect(brushRadiusInRaster(40, 0.5, 0.25)).toBe(10)
  })
  it('is 0 when the scale is unknown', () => {
    expect(brushRadiusInRaster(40, 0, 1)).toBe(0)
  })
})
