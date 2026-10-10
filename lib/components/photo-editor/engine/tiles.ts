export interface TileRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Tile extends TileRect {
  /** The tile grown by the halo and clamped to the output. */
  haloRect: TileRect
}

/**
 * Splits an output of `width` x `height` into tiles that cover it exactly.
 * A tile renders its `haloRect` (inner rect plus `halo` pixels on every side,
 * clamped to the output) and only the inner rect is copied out, so
 * neighbourhood effects are right at tile seams. The inner size is
 * `maxTile - 2 * halo`; an output that fits `maxTile` is one tile.
 */
export const planTiles = (
  width: number,
  height: number,
  maxTile: number,
  halo: number
): Tile[] => {
  if (width <= 0 || height <= 0) return []
  if (width <= maxTile && height <= maxTile) {
    const whole = { x: 0, y: 0, w: width, h: height }
    return [{ ...whole, haloRect: whole }]
  }
  const inner = Math.max(1, maxTile - 2 * halo)
  const tiles: Tile[] = []
  for (let y = 0; y < height; y += inner) {
    for (let x = 0; x < width; x += inner) {
      const w = Math.min(inner, width - x)
      const h = Math.min(inner, height - y)
      const left = Math.max(0, x - halo)
      const top = Math.max(0, y - halo)
      const right = Math.min(width, x + w + halo)
      const bottom = Math.min(height, y + h + halo)
      tiles.push({
        x,
        y,
        w,
        h,
        haloRect: { x: left, y: top, w: right - left, h: bottom - top }
      })
    }
  }
  return tiles
}
