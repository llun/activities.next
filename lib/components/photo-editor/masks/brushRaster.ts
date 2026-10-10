import type { MaskRaster } from './maskRaster'

export type BrushMode = 'add' | 'erase'

export const MIN_BRUSH_SIZE = 1
export const MAX_BRUSH_SIZE = 200
export const DEFAULT_BRUSH_SIZE = 40

interface Point {
  x: number
  y: number
}

/**
 * Paints a round stroke from `from` to `to` (raster pixels) into `raster`,
 * in place: the pixels within `radius` of the segment, with a one pixel soft
 * edge. `add` raises a pixel to the stroke's coverage, `erase` lowers it by
 * that coverage. A dab is a stroke whose two ends are the same point.
 */
export const paintStroke = (
  raster: MaskRaster,
  from: Point,
  to: Point,
  radius: number,
  mode: BrushMode
): void => {
  const reach = Math.max(0.5, radius)
  const { width, height, data } = raster
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - reach - 1))
  const x1 = Math.min(width - 1, Math.ceil(Math.max(from.x, to.x) + reach + 1))
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - reach - 1))
  const y1 = Math.min(height - 1, Math.ceil(Math.max(from.y, to.y) + reach + 1))
  const dx = to.x - from.x
  const dy = to.y - from.y
  const lengthSquared = dx * dx + dy * dy

  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      // The centre of pixel (x, y) is (x + 0.5, y + 0.5).
      const px = x + 0.5
      const py = y + 0.5
      const t =
        lengthSquared === 0
          ? 0
          : Math.min(
              1,
              Math.max(
                0,
                ((px - from.x) * dx + (py - from.y) * dy) / lengthSquared
              )
            )
      const distance = Math.hypot(
        px - (from.x + t * dx),
        py - (from.y + t * dy)
      )
      const coverage = Math.min(1, Math.max(0, reach + 0.5 - distance))
      if (coverage === 0) continue
      const index = y * width + x
      data[index] =
        mode === 'add'
          ? Math.max(data[index], Math.round(coverage * 255))
          : Math.round(data[index] * (1 - coverage))
    }
  }
}

/**
 * The brush radius in raster pixels for a brush of `size` CSS pixels on the
 * stage: `cssPerSource` is how many CSS pixels one source pixel covers, and
 * `rasterPerSource` how many raster pixels one source pixel covers.
 */
export const brushRadiusInRaster = (
  size: number,
  cssPerSource: number,
  rasterPerSource: number
): number => {
  if (!(cssPerSource > 0)) return 0
  return (size / 2 / cssPerSource) * rasterPerSource
}
