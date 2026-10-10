import { planTiles } from './tiles'

const coverage = (
  width: number,
  height: number,
  tiles: ReturnType<typeof planTiles>
) => {
  const seen = new Uint8Array(width * height)
  for (const tile of tiles) {
    for (let y = tile.y; y < tile.y + tile.h; y += 1) {
      for (let x = tile.x; x < tile.x + tile.w; x += 1) seen[y * width + x] += 1
    }
  }
  return seen
}

describe('planTiles', () => {
  it('returns one tile when the output fits', () => {
    const tiles = planTiles(300, 200, 4096, 8)
    expect(tiles).toEqual([
      {
        x: 0,
        y: 0,
        w: 300,
        h: 200,
        haloRect: { x: 0, y: 0, w: 300, h: 200 }
      }
    ])
  })

  it.each([
    [100, 70, 40, 4],
    [97, 53, 32, 8],
    [64, 64, 64, 8]
  ])('covers %i x %i exactly with max tile %i', (width, height, max, halo) => {
    const tiles = planTiles(width, height, max, halo)
    const seen = coverage(width, height, tiles)
    expect(seen.every((count) => count === 1)).toBe(true)
    for (const tile of tiles) {
      expect(tile.haloRect.w).toBeLessThanOrEqual(max)
      expect(tile.haloRect.h).toBeLessThanOrEqual(max)
    }
  })

  it('grows the halo and clamps it at the edges', () => {
    const tiles = planTiles(100, 100, 40, 8)
    const first = tiles[0]
    expect(first.haloRect.x).toBe(0)
    expect(first.haloRect.y).toBe(0)
    expect(first.haloRect.w).toBe(first.w + 8)
    const middle = tiles.find((t) => t.x > 0 && t.y > 0 && t.x + t.w < 100)
    expect(middle).toBeDefined()
    expect(middle!.haloRect.x).toBe(middle!.x - 8)
    expect(middle!.haloRect.w).toBe(middle!.w + 16)
    const last = tiles[tiles.length - 1]
    expect(last.haloRect.x + last.haloRect.w).toBe(100)
    expect(last.haloRect.y + last.haloRect.h).toBe(100)
  })

  it('tiles 8000 x 6000 with a 4096 maximum', () => {
    const tiles = planTiles(8000, 6000, 4096, 8)
    // Inner size 4080: 2 columns, 2 rows.
    expect(tiles).toHaveLength(4)
    const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0)
    expect(area).toBe(8000 * 6000)
    for (const tile of tiles) {
      expect(tile.haloRect.w).toBeLessThanOrEqual(4096)
      expect(tile.haloRect.h).toBeLessThanOrEqual(4096)
    }
  })

  it('returns nothing for an empty output', () => {
    expect(planTiles(0, 10, 100, 8)).toEqual([])
  })
})
