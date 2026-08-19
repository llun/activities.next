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

    expect(totalEdges(first)).toBeGreaterThan(0)
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
    // Two valid points EITHER SIDE of the bad one, so both runs survive and
    // there is real output to inspect — with one point per side the whole
    // fixture yields nothing and the assertions below run over an empty map.
    const deltas = build([
      {
        isHiddenByPrivacy: false,
        points: [
          { lat: 52.37, lng: 4.89 },
          { lat: 52.3702, lng: 4.8904 },
          { lat: Number.NaN, lng: 4.8906 },
          { lat: 52.3706, lng: 4.891 },
          { lat: 52.3709, lng: 4.8914 }
        ]
      }
    ])

    expect(totalEdges(deltas)).toBeGreaterThan(0)
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

    expect(totalEdges(there)).toBeGreaterThan(0)
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

    expect(totalEdges(deltas)).toBeGreaterThan(0)
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
      // At z16 a tile is about 612m, so a 5km pair genuinely crosses several —
      // the realistic case. The same test at a coarse zoom would need a pair
      // hundreds of kilometres long, which is a teleport, not a diagonal.
      const zoom = 16
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 52.34, lng: 4.85 },
              { lat: 52.38, lng: 4.93 }
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
      const zoom = 16
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 52.32, lng: 4.89 },
              { lat: 52.4, lng: 4.892 }
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
            // Short pairs sitting ON the extremes, not one pair reaching
            // across to them: a span that wide is a discontinuity and would
            // be split, leaving nothing to inspect.
            points: [
              { lat: -85, lng: -179.99 },
              { lat: -84.99, lng: -179.9 }
            ]
          }
        ],
        [zoom]
      )

      const lastTile = tileCountAtZoom(zoom) - 1
      expect(totalEdges(deltas)).toBeGreaterThan(0)
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

  describe('the recording-jump split', () => {
    const pairAt = (zoom: number, fromLng: number, toLng: number) =>
      build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: fromLng },
              { lat: 0, lng: toLng }
            ]
          }
        ],
        [zoom]
      )

    it('splits a pair that spans absurdly many tiles', () => {
      // 90 degrees at z16 is a quarter of the world, about 16,000 tiles — no
      // activity has two consecutive points that far apart, so this is a bad
      // GPS fix and every tile it crosses would be a stored row. The run is
      // split, leaving two single points, which is nothing to draw.
      expect(pairAt(16, 0, 90).size).toBe(0)
    })

    it('keeps a long straight pair that is merely unusual', () => {
      // Two degrees is roughly 360 tiles at z16 — longer than any real
      // straight road, and it must still be stored whole.
      const deltas = pairAt(16, 0, 2)
      expect(deltas.size).toBeGreaterThan(300)
    })

    it('keeps the geometry either side of a bad fix', () => {
      // The run is split at the dropout, not abandoned at it: a single bad fix
      // must not cost an activity everything recorded after it. The two halves
      // are then tiled independently, so a one-point remainder either side is
      // discarded — there is no line to draw through a lone point.
      const ride = Array.from({ length: 40 }, (_value, index) => ({
        lat: 52.37 + index * 0.0004,
        lng: 4.89 + index * 0.0006
      }))
      const clean = build([{ isHiddenByPrivacy: false, points: ride }], [16])
      const glitched = build(
        [
          {
            isHiddenByPrivacy: false,
            // "Null island" — the most common dropout, and entirely in range,
            // so nothing upstream rejects it.
            points: [
              ...ride.slice(0, 20),
              { lat: 0, lng: 0 },
              ...ride.slice(20)
            ]
          }
        ],
        [16]
      )

      expect(clean.size).toBeGreaterThan(0)
      // Every clean tile survives, and the glitch adds only a bounded number.
      for (const key of clean.keys()) {
        expect(glitched.has(key)).toBe(true)
      }
      expect(glitched.size).toBeLessThan(clean.size + 8)
    })
  })

  describe('discontinuities', () => {
    it('does not draw across the antimeridian', () => {
      // Without the split, the pair projects to opposite edges of the world and
      // lays edges through every tile column between them.
      // Two points either side, so both runs survive and there is something to
      // count: with one point each the whole fixture yields nothing and any
      // upper bound is satisfied by zero.
      const zoom = 6
      const wrapped = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: 179.7 },
              { lat: 0, lng: 179.9 },
              { lat: 0, lng: -179.9 },
              { lat: 0, lng: -179.7 }
            ]
          }
        ],
        [zoom]
      )

      // Exactly the two end tiles — not a stripe across every column between.
      expect(wrapped.size).toBe(2)
      expect(new Set([...wrapped.values()].map((delta) => delta.x))).toEqual(
        new Set([0, tileCountAtZoom(zoom) - 1])
      )
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

      // Both ends must actually survive: the run after the jump starts at the
      // point that caused it, so dropping that point would silently delete the
      // whole far side.
      const xs = [
        ...new Set([...deltas.values()].map((delta) => delta.x))
      ].sort((a, b) => a - b)
      const lastTile = tileCountAtZoom(zoom) - 1
      expect(xs[0]).toBe(0)
      expect(xs[xs.length - 1]).toBe(lastTile)
      // And nothing spanning the map between them.
      expect(deltas.size).toBeLessThan(tileCountAtZoom(zoom) / 2)
    })

    it.each([
      // Straddling the cap itself, at the equator where a z16 tile is 612m:
      // 5.6 degrees spans 1,019 tiles and 5.7 spans 1,037. Without a pair
      // either side of the boundary the cap can move by a factor of ten in
      // both directions with every test still green — the fixtures below sit
      // at 182 and 32,585, nowhere near it.
      {
        description: 'a gap just inside the span cap',
        lngs: [0, 5.6] as [number, number],
        split: false
      },
      {
        description: 'a gap just past the span cap',
        lngs: [0, 5.7] as [number, number],
        split: true
      },
      {
        description: 'a sparse but real gap of about 100km',
        lngs: [0, 1] as [number, number],
        split: false
      },
      {
        description: 'a jump most of the way round the world',
        lngs: [0, 179] as [number, number],
        split: true
      },
      {
        description: 'a jump across the date line',
        lngs: [179.9, -179.9] as [number, number],
        split: true
      }
    ])('treats $description correctly', ({ lngs, split }) => {
      // The threshold itself, from both sides: loose enough to keep a sparse
      // recording whole, tight enough that nothing draws a line between
      // continents.
      const zoom = 16
      const deltas = build(
        [
          {
            isHiddenByPrivacy: false,
            points: [
              { lat: 0, lng: lngs[0] },
              { lat: 0, lng: lngs[1] }
            ]
          }
        ],
        [zoom]
      )

      // A split run of two single points yields nothing; an unsplit pair draws.
      expect(deltas.size === 0).toBe(split)
    })
  })

  describe('the zoom cascade', () => {
    /**
     * Structure at several scales at once: broad sweeps a coarse zoom keeps,
     * and fine wiggles only the finest zoom can resolve. A straight or gently
     * curving fixture cannot tell the cascade's direction apart, because every
     * level simplifies it to the same two endpoints.
     */
    const multiScaleTrack: Array<[number, number]> = Array.from(
      { length: 1_200 },
      (_value, index) => [
        52.37 + Math.sin(index / 90) * 0.05 + Math.sin(index / 3) * 0.00004,
        4.89 + index * 0.0004
      ]
    )

    it('builds fine zooms from the original, not from a coarse simplification', () => {
      // The direction of the cascade. Ascending, z16 would be built from the
      // 611m z8 simplification and lose almost everything — and because the
      // levels then agree, a test comparing them to each other cannot see it.
      const cascaded = build([visible(multiScaleTrack)], [8, 12, 16])
      const directAt16 = build([visible(multiScaleTrack)], [16])

      const edgesAt = (deltas: Map<string, TileDelta>, zoom: number) =>
        [...deltas.values()]
          .filter((delta) => delta.z === zoom)
          .reduce((sum, delta) => sum + delta.edges.size, 0)

      const cascadedAt16 = edgesAt(cascaded, 16)
      expect(cascadedAt16).toBeGreaterThan(0)
      // Building the ladder together must not cost the finest level its detail.
      expect(cascadedAt16).toBe(edgesAt(directAt16, 16))
      // And the finest level must hold strictly more than the coarsest.
      expect(cascadedAt16).toBeGreaterThan(edgesAt(cascaded, 8) * 2)
    })

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
      const deltas = build([visible(multiScaleTrack)], [8, 12, 16])

      const edgesAt = (zoom: number) =>
        [...deltas.values()]
          .filter((delta) => delta.z === zoom)
          .reduce((sum, delta) => sum + delta.edges.size, 0)

      // Strict, not `>=`: three identical levels would satisfy `>=` while
      // meaning the per-zoom tolerance had stopped doing anything at all.
      expect(edgesAt(16)).toBeGreaterThan(edgesAt(12))
      expect(edgesAt(12)).toBeGreaterThan(edgesAt(8))
    })
  })
})
