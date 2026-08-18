import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'
import { unpackVertex } from '@/lib/services/fitness-files/heatmapTiles/edgeMerge'
import {
  lngLatToTileLocal,
  tileCountAtZoom
} from '@/lib/services/fitness-files/heatmapTiles/tileCodec'
import { buildTileDeltasForActivity } from '@/lib/services/fitness-files/heatmapTiles/tiler'
import type {
  TileDelta,
  TilerSegment
} from '@/lib/services/fitness-files/heatmapTiles/tiler'

const FLOOR_METERS = 1

const visible = (points: Array<[number, number]>): TilerSegment => ({
  isHiddenByPrivacy: false,
  points: points.map(([lat, lng]) => ({ lat, lng }))
})

const build = (segments: TilerSegment[], ladderZooms: number[] = [16]) =>
  buildTileDeltasForActivity({
    segments,
    ladderZooms,
    toleranceFloorMeters: FLOOR_METERS
  })

const totalEdges = (deltas: Map<string, TileDelta>) =>
  [...deltas.values()].reduce((sum, delta) => sum + delta.edges.size, 0)

/** A short east-west track that stays well inside one tile at z16. */
const shortTrack: Array<[number, number]> = [
  [52.37, 4.89],
  [52.3701, 4.8902],
  [52.3702, 4.8905]
]

/** Tens of kilometres, so it is still several pixels wide at z8. */
const longTrack: Array<[number, number]> = Array.from(
  { length: 40 },
  (_value, index) => [52.37 + index * 0.02, 4.89 + index * 0.03]
)

describe('buildTileDeltasForActivity', () => {
  it('turns a track into tile edges', () => {
    const deltas = build([visible(shortTrack)])
    expect(deltas.size).toBeGreaterThan(0)
    expect(totalEdges(deltas)).toBeGreaterThan(0)
  })

  it('builds every ladder zoom asked for', () => {
    // Long enough to survive the coarse levels: a z8 pixel is 611m, so a
    // street-length track legitimately has nothing to say there.
    const deltas = build([visible(longTrack)], [8, 12, 16])
    const zooms = new Set([...deltas.values()].map((delta) => delta.z))
    expect(zooms).toEqual(new Set([8, 12, 16]))
  })

  it('drops a track too short to register at a coarse zoom', () => {
    // Not a failure: 40m of road is well under one z8 pixel, so both ends
    // quantize onto the same cell and there is no edge to store.
    const deltas = build([visible(shortTrack)], [8])
    expect(deltas.size).toBe(0)
  })

  it('is deterministic — the same track twice gives the same tiles and edges', () => {
    const first = build([visible(shortTrack)], [12, 16])
    const second = build([visible(shortTrack)], [12, 16])

    expect([...second.keys()].sort()).toEqual([...first.keys()].sort())
    for (const [key, delta] of first) {
      expect([...second.get(key)!.edges.keys()].sort()).toEqual(
        [...delta.edges.keys()].sort()
      )
    }
  })

  it.each([
    { description: 'an empty segment list', segments: [] as TilerSegment[] },
    { description: 'a segment with no points', segments: [visible([])] },
    { description: 'a single point', segments: [visible([[52.37, 4.89]])] },
    {
      description: 'points that all quantize onto one pixel',
      segments: [
        visible([
          [52.37, 4.89],
          [52.37, 4.89],
          [52.37, 4.89]
        ])
      ]
    }
  ])('produces nothing for $description', ({ segments }) => {
    expect(build(segments).size).toBe(0)
  })

  it('still builds a run whose FIRST point is non-finite', () => {
    // Not just cosmetic. Simplification anchors its projection at the first
    // point's latitude, so a leading NaN makes every projected coordinate NaN
    // and collapses the whole run — the valid points after it would be lost.
    const deltas = build([
      {
        isHiddenByPrivacy: false,
        points: [
          { lat: Number.NaN, lng: Number.NaN },
          { lat: 52.37, lng: 4.89 },
          { lat: 52.3705, lng: 4.891 },
          { lat: 52.371, lng: 4.892 }
        ]
      }
    ])

    expect(totalEdges(deltas)).toBeGreaterThan(0)
  })

  it('skips non-finite coordinates instead of emitting a corrupt tile', () => {
    const deltas = build([
      {
        isHiddenByPrivacy: false,
        points: [
          { lat: 52.37, lng: 4.89 },
          { lat: Number.NaN, lng: 4.8902 },
          { lat: 52.3705, lng: 4.891 }
        ]
      }
    ])

    for (const key of deltas.keys()) {
      expect(key).not.toContain('NaN')
    }
    for (const delta of deltas.values()) {
      expect(Number.isInteger(delta.x)).toBe(true)
      expect(Number.isInteger(delta.y)).toBe(true)
    }
  })

  it('counts an out-and-back street once, not twice', () => {
    // Heat should say how often a street is used, not how an activity was
    // routed — and a doubled count would be unstable under GPS jitter too.
    const out: Array<[number, number]> = [
      [52.37, 4.89],
      [52.3705, 4.891],
      [52.371, 4.892]
    ]
    const there = build([visible(out)])
    const andBack = build([visible([...out, ...[...out].reverse().slice(1)])])

    expect(totalEdges(andBack)).toBe(totalEdges(there))
    for (const [key, delta] of andBack) {
      for (const edge of delta.edges.values()) {
        expect(edge.count).toBe(1)
      }
      expect(there.has(key)).toBe(true)
    }
  })

  it('never merges hidden geometry into a visible edge', () => {
    const deltas = build([
      visible(shortTrack),
      { isHiddenByPrivacy: true, points: visible(shortTrack).points }
    ])

    for (const delta of deltas.values()) {
      const hiddenFlags = [...delta.edges.values()].map((edge) => edge.hidden)
      expect(hiddenFlags).toContain(true)
      expect(hiddenFlags).toContain(false)
      // Same geometry, two classes: the keys must differ, never collapse.
      expect(delta.edges.size).toBe(hiddenFlags.length)
    }
  })

  describe('tile boundaries', () => {
    /** A pair of coordinates known to straddle a tile boundary at `zoom`. */
    const straddlingPair = (zoom: number) => {
      const lat = 52.37
      const placed = lngLatToTileLocal({ lat, lng: 4.89 }, zoom)
      // The longitude of the next tile's left edge, nudged either side.
      const edgeLng = ((placed.x + 1) / tileCountAtZoom(zoom)) * 360 - 180
      const span = 360 / tileCountAtZoom(zoom) / 8
      return {
        from: { lat, lng: edgeLng - span },
        to: { lat, lng: edgeLng + span }
      }
    }

    it('splits a crossing pair into both tiles', () => {
      const zoom = 12
      const { from, to } = straddlingPair(zoom)
      const deltas = build(
        [{ isHiddenByPrivacy: false, points: [from, to] }],
        [zoom]
      )

      expect(deltas.size).toBe(2)
    })

    it('gives both tiles the same boundary vertex, so no seam opens', () => {
      // The left tile's crossing sits at local 256 and the right tile's at 0 —
      // the same world position — and the other coordinate must be identical
      // in both, or a one-pixel seam appears along the boundary.
      const zoom = 12
      const { from, to } = straddlingPair(zoom)
      const deltas = build(
        [{ isHiddenByPrivacy: false, points: [from, to] }],
        [zoom]
      )

      const byTile = [...deltas.values()].sort((a, b) => a.x - b.x)
      expect(byTile).toHaveLength(2)

      const boundaryVertexOf = (delta: TileDelta, expectedX: number) => {
        const vertices = [...delta.edges.values()].flatMap((edge) => [
          unpackVertex(edge.a),
          unpackVertex(edge.b)
        ])
        const match = vertices.find((vertex) => vertex.x === expectedX)
        expect(match).toBeDefined()
        return match!
      }

      const left = boundaryVertexOf(byTile[0], TILE_EXTENT)
      const right = boundaryVertexOf(byTile[1], 0)
      expect(left.y).toBe(right.y)
    })

    it('contributes to every tile a long diagonal passes through', () => {
      // A pair split only at its first boundary would skip the tiles in
      // between, leaving gaps in the heat.
      const zoom = 8
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 10, lng: -20 },
              { lat: 40, lng: 30 }
            ]
          }
        ],
        [zoom]
      )

      expect(deltas.size).toBeGreaterThan(4)
      // Contiguous: no tile column in the span is missed.
      const xs = [
        ...new Set([...deltas.values()].map((delta) => delta.x))
      ].sort((a, b) => a - b)
      expect(xs[xs.length - 1] - xs[0] + 1).toBe(xs.length)
    })

    it('contributes to every tile a north-south track passes through', () => {
      // The y axis needs subdividing exactly as much as the x axis does.
      // Subdividing only on x leaves a mostly-vertical track skipping the tile
      // rows between its endpoints.
      const zoom = 8
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: -35, lng: 20 },
              { lat: 35, lng: 20.05 }
            ]
          }
        ],
        [zoom]
      )

      const ys = [
        ...new Set([...deltas.values()].map((delta) => delta.y))
      ].sort((a, b) => a - b)
      expect(ys.length).toBeGreaterThan(4)
      expect(ys[ys.length - 1] - ys[0] + 1).toBe(ys.length)
    })

    it('keeps every emitted coordinate inside the tile grid and the extent', () => {
      const zoom = 6
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: -80, lng: -179.9 },
              { lat: 80, lng: 179.9 }
            ]
          }
        ],
        [zoom]
      )

      const lastTile = tileCountAtZoom(zoom) - 1
      for (const delta of deltas.values()) {
        expect(delta.x).toBeGreaterThanOrEqual(0)
        expect(delta.y).toBeGreaterThanOrEqual(0)
        expect(delta.x).toBeLessThanOrEqual(lastTile)
        expect(delta.y).toBeLessThanOrEqual(lastTile)

        for (const edge of delta.edges.values()) {
          for (const packed of [edge.a, edge.b]) {
            const { x, y } = unpackVertex(packed)
            expect(x).toBeGreaterThanOrEqual(0)
            expect(x).toBeLessThanOrEqual(TILE_EXTENT)
            expect(y).toBeGreaterThanOrEqual(0)
            expect(y).toBeLessThanOrEqual(TILE_EXTENT)
          }
        }
      }
    })

    it('places a track on the antimeridian in the last tile, not one past it', () => {
      const zoom = 6
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: 179.8 },
              { lat: 0.2, lng: 180 }
            ]
          }
        ],
        [zoom]
      )

      const lastTile = tileCountAtZoom(zoom) - 1
      expect(deltas.size).toBeGreaterThan(0)
      for (const delta of deltas.values()) {
        expect(delta.x).toBeLessThanOrEqual(lastTile)
      }
    })
  })

  describe('discontinuities', () => {
    it('does not draw across the antimeridian', () => {
      // Without the split, the pair projects to opposite edges of the world and
      // lays edges through every tile column between them.
      const zoom = 6
      const wrapped = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: 179.9 },
              { lat: 0, lng: -179.9 }
            ]
          }
        ],
        [zoom]
      )

      expect(wrapped.size).toBeLessThanOrEqual(2)
    })

    it('keeps the runs either side of a discontinuity', () => {
      const zoom = 10
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: 179.8 },
              { lat: 0, lng: 179.9 },
              { lat: 0, lng: -179.9 },
              { lat: 0, lng: -179.8 }
            ]
          }
        ],
        [zoom]
      )

      const xs = new Set([...deltas.values()].map((delta) => delta.x))
      // Both ends present, and nothing spanning the whole map between them.
      expect(xs.size).toBeGreaterThan(0)
      expect(deltas.size).toBeLessThan(tileCountAtZoom(zoom) / 2)
    })
  })

  describe('the zoom cascade', () => {
    it('keeps a coarse level within its own tolerance of building it directly', () => {
      const track: Array<[number, number]> = Array.from(
        { length: 400 },
        (_value, index) => [
          52.37 + index * 0.0004 + (index % 5) * 0.00002,
          4.89 + index * 0.0006
        ]
      )

      const cascaded = build([visible(track)], [8, 12, 16])
      const direct = build([visible(track)], [8])

      const cascadedAt8 = [...cascaded.values()].filter(
        (delta) => delta.z === 8
      )
      const directAt8 = [...direct.values()]

      // Same tiles touched: the cascade must not shift where geometry lands.
      expect(
        new Set(cascadedAt8.map((delta) => `${delta.x}:${delta.y}`))
      ).toEqual(new Set(directAt8.map((delta) => `${delta.x}:${delta.y}`)))
    })

    it('stores strictly less at coarser zooms than at finer ones', () => {
      const track: Array<[number, number]> = Array.from(
        { length: 300 },
        (_value, index) => [
          52.37 + index * 0.0003 + (index % 7) * 0.00004,
          4.89 + index * 0.0005
        ]
      )
      const deltas = build([visible(track)], [8, 12, 16])

      const edgesAt = (zoom: number) =>
        [...deltas.values()]
          .filter((delta) => delta.z === zoom)
          .reduce((sum, delta) => sum + delta.edges.size, 0)

      expect(edgesAt(16)).toBeGreaterThanOrEqual(edgesAt(12))
      expect(edgesAt(12)).toBeGreaterThanOrEqual(edgesAt(8))
    })
  })
})
