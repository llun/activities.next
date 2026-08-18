import { TILE_EXTENT } from '@/lib/services/fitness-files/heatmapTiles/constants'
import {
  VERTEX_PACK_BASE,
  assembleEdgesToSegments,
  edgeKey,
  explodeTileToEdges,
  mergeTileDelta,
  packVertex,
  unpackVertex
} from '@/lib/services/fitness-files/heatmapTiles/edgeMerge'
import type { TileEdgeMap } from '@/lib/services/fitness-files/heatmapTiles/edgeMerge'
import type { TileSegment } from '@/lib/services/fitness-files/heatmapTiles/tileCodec'

/** The edge multiset a tile stands for, order-independent, counts included. */
const edgeMultiset = (segments: TileSegment[]) =>
  [...explodeTileToEdges(segments).entries()]
    .map(([key, edge]) => `${key}=${edge.count}`)
    .sort()

const buildEdges = (
  entries: Array<{
    a: [number, number]
    b: [number, number]
    count: number
    hidden?: boolean
  }>
): TileEdgeMap => {
  const edges: TileEdgeMap = new Map()
  for (const entry of entries) {
    const a = packVertex(entry.a[0], entry.a[1])
    const b = packVertex(entry.b[0], entry.b[1])
    const hidden = Boolean(entry.hidden)
    edges.set(edgeKey(a, b, hidden), {
      a: Math.min(a, b),
      b: Math.max(a, b),
      hidden,
      count: entry.count
    })
  }
  return edges
}

describe('packVertex', () => {
  it('round trips every corner of the coordinate space', () => {
    for (const x of [0, 1, 128, TILE_EXTENT]) {
      for (const y of [0, 1, 128, TILE_EXTENT]) {
        expect(unpackVertex(packVertex(x, y))).toEqual({ x, y })
      }
    }
  })

  it('does not collide across the inclusive edge', () => {
    // The reason the base is 257 and not 256: the space runs 0..256, so a
    // point on a tile's far boundary is 256 here and 0 in the neighbour.
    // Base 256 makes (1,0) and (0,256) the same integer, welding two
    // unrelated streets together.
    expect(packVertex(1, 0)).not.toBe(packVertex(0, TILE_EXTENT))
    expect(VERTEX_PACK_BASE).toBe(TILE_EXTENT + 1)
  })

  it('is injective over the whole space', () => {
    const seen = new Set<number>()
    for (let x = 0; x <= TILE_EXTENT; x += 1) {
      for (let y = 0; y <= TILE_EXTENT; y += 1) {
        seen.add(packVertex(x, y))
      }
    }
    expect(seen.size).toBe((TILE_EXTENT + 1) ** 2)
  })
})

describe('edgeKey', () => {
  it('normalizes direction, so an out-and-back is one edge', () => {
    const a = packVertex(1, 1)
    const b = packVertex(2, 2)
    expect(edgeKey(a, b, false)).toBe(edgeKey(b, a, false))
  })

  it('keeps hidden and visible geometry apart', () => {
    const a = packVertex(1, 1)
    const b = packVertex(2, 2)
    expect(edgeKey(a, b, true)).not.toBe(edgeKey(a, b, false))
  })
})

describe('explodeTileToEdges', () => {
  it('breaks a polyline into its edges', () => {
    const edges = explodeTileToEdges([{ count: 2, points: [0, 0, 1, 1, 2, 2] }])
    expect(edges.size).toBe(2)
    expect([...edges.values()].every((edge) => edge.count === 2)).toBe(true)
  })

  it('sums an edge that appears in more than one run', () => {
    const edges = explodeTileToEdges([
      { count: 2, points: [0, 0, 1, 1] },
      { count: 3, points: [1, 1, 0, 0] }
    ])
    expect(edges.size).toBe(1)
    expect([...edges.values()][0].count).toBe(5)
  })

  it('drops a self-loop rather than storing geometry with no length', () => {
    expect(explodeTileToEdges([{ count: 1, points: [4, 4, 4, 4] }]).size).toBe(
      0
    )
  })

  it('is empty for a run too short to have an edge', () => {
    expect(explodeTileToEdges([{ count: 1, points: [4, 4] }]).size).toBe(0)
  })
})

describe('assembleEdgesToSegments', () => {
  it('joins a chain into one polyline', () => {
    const segments = assembleEdgesToSegments(
      buildEdges([
        { a: [0, 0], b: [1, 1], count: 1 },
        { a: [1, 1], b: [2, 2], count: 1 },
        { a: [2, 2], b: [3, 3], count: 1 }
      ])
    )
    expect(segments).toHaveLength(1)
    expect(segments[0].points).toHaveLength(8)
    expect(segments[0].count).toBe(1)
  })

  it('never merges edges of different counts into one run', () => {
    // A stored run carries ONE count for all its points, so putting a
    // twice-ridden edge in the same run as a once-ridden one would have to
    // pick a count — and whichever it picked would be wrong for the other.
    const segments = assembleEdgesToSegments(
      buildEdges([
        { a: [0, 0], b: [1, 1], count: 1 },
        { a: [1, 1], b: [2, 2], count: 2 }
      ])
    )
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.count).sort()).toEqual([1, 2])
  })

  it('never merges hidden geometry into a visible run', () => {
    const segments = assembleEdgesToSegments(
      buildEdges([
        { a: [0, 0], b: [1, 1], count: 1 },
        { a: [1, 1], b: [2, 2], count: 1, hidden: true }
      ])
    )
    expect(segments).toHaveLength(2)
    expect(segments.filter((segment) => segment.hidden)).toHaveLength(1)
  })

  it('keeps a closed loop, which has no odd-degree vertex to start from', () => {
    // The classic drop: a roundabout or a lap is all-even-degree, so a walk
    // that only starts at odd-degree vertices never enters it and every edge
    // in it vanishes.
    const loop = buildEdges([
      { a: [0, 0], b: [4, 0], count: 1 },
      { a: [4, 0], b: [4, 4], count: 1 },
      { a: [4, 4], b: [0, 4], count: 1 },
      { a: [0, 4], b: [0, 0], count: 1 }
    ])
    const segments = assembleEdgesToSegments(loop)

    expect(edgeMultiset(segments)).toEqual(
      [...loop.entries()].map(([key, edge]) => `${key}=${edge.count}`).sort()
    )
  })

  it.each([
    {
      description: 'a simple chain',
      entries: [
        {
          a: [0, 0] as [number, number],
          b: [1, 1] as [number, number],
          count: 1
        },
        {
          a: [1, 1] as [number, number],
          b: [2, 2] as [number, number],
          count: 1
        }
      ]
    },
    {
      description: 'a junction of degree three',
      entries: [
        {
          a: [5, 5] as [number, number],
          b: [0, 5] as [number, number],
          count: 1
        },
        {
          a: [5, 5] as [number, number],
          b: [10, 5] as [number, number],
          count: 1
        },
        {
          a: [5, 5] as [number, number],
          b: [5, 10] as [number, number],
          count: 1
        }
      ]
    },
    {
      description: 'a figure eight sharing one degree-four vertex',
      entries: [
        {
          a: [5, 5] as [number, number],
          b: [0, 0] as [number, number],
          count: 1
        },
        {
          a: [0, 0] as [number, number],
          b: [0, 5] as [number, number],
          count: 1
        },
        {
          a: [0, 5] as [number, number],
          b: [5, 5] as [number, number],
          count: 1
        },
        {
          a: [5, 5] as [number, number],
          b: [10, 10] as [number, number],
          count: 1
        },
        {
          a: [10, 10] as [number, number],
          b: [10, 5] as [number, number],
          count: 1
        },
        {
          a: [10, 5] as [number, number],
          b: [5, 5] as [number, number],
          count: 1
        }
      ]
    },
    {
      description: 'two runs meeting at one vertex with mixed counts',
      entries: [
        {
          a: [0, 0] as [number, number],
          b: [1, 1] as [number, number],
          count: 3
        },
        {
          a: [1, 1] as [number, number],
          b: [2, 2] as [number, number],
          count: 1
        },
        {
          a: [1, 1] as [number, number],
          b: [3, 3] as [number, number],
          count: 3
        }
      ]
    },
    {
      description: 'a loop with a tail',
      entries: [
        {
          a: [0, 0] as [number, number],
          b: [4, 0] as [number, number],
          count: 2
        },
        {
          a: [4, 0] as [number, number],
          b: [4, 4] as [number, number],
          count: 2
        },
        {
          a: [4, 4] as [number, number],
          b: [0, 0] as [number, number],
          count: 2
        },
        {
          a: [0, 0] as [number, number],
          b: [-0 + 8, 8] as [number, number],
          count: 2
        }
      ]
    }
  ])('preserves the edge multiset of $description', ({ entries }) => {
    const edges = buildEdges(entries)
    const expected = [...edges.entries()]
      .map(([key, edge]) => `${key}=${edge.count}`)
      .sort()

    expect(edgeMultiset(assembleEdgesToSegments(edges))).toEqual(expected)
  })

  it('is empty for an empty edge set', () => {
    expect(assembleEdgesToSegments(new Map())).toEqual([])
  })

  it('assembles a dense tile whole, with no cap and no quadratic blowup', () => {
    // There is deliberately no per-tile maximum, so the assembler has to stay
    // linear: a downtown tile crossed by thousands of activities is the
    // ordinary case, not the adversarial one.
    const entries = Array.from({ length: 4_000 }, (_value, index) => ({
      a: [index % 200, Math.floor(index / 200)] as [number, number],
      b: [(index % 200) + 1, Math.floor(index / 200)] as [number, number],
      count: (index % 3) + 1
    }))
    const edges = buildEdges(entries)

    const startedAt = process.hrtime.bigint()
    const segments = assembleEdgesToSegments(edges)
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000

    expect(edgeMultiset(segments)).toEqual(
      [...edges.entries()].map(([key, edge]) => `${key}=${edge.count}`).sort()
    )
    // Generous, but a quadratic assembler over 4,000 edges does not finish here.
    expect(elapsedMs).toBeLessThan(2_000)
  })
})

describe('explode and assemble round trip', () => {
  it.each([
    {
      description: 'a single run',
      segments: [{ count: 1, points: [0, 0, 1, 1, 2, 2] }]
    },
    {
      description: 'mixed counts and privacy classes',
      segments: [
        { count: 2, points: [0, 0, 1, 1] },
        { count: 5, points: [1, 1, 2, 2] },
        { count: 1, hidden: true, points: [2, 2, 3, 3] }
      ]
    },
    {
      description: 'coordinates at both ends of the space',
      segments: [
        { count: 1, points: [0, 0, TILE_EXTENT, TILE_EXTENT] },
        { count: 1, points: [0, TILE_EXTENT, TILE_EXTENT, 0] }
      ]
    }
  ])('preserves $description exactly', ({ segments }) => {
    const before = edgeMultiset(segments)
    const after = edgeMultiset(
      assembleEdgesToSegments(explodeTileToEdges(segments))
    )
    expect(after).toEqual(before)
  })
})

describe('mergeTileDelta', () => {
  const existing: TileSegment[] = [{ count: 1, points: [0, 0, 1, 1] }]

  it('adds to a tile this same build already wrote', () => {
    const merged = mergeTileDelta({
      existingSegments: existing,
      existingVersion: 7,
      buildVersion: 7,
      delta: buildEdges([{ a: [0, 0], b: [1, 1], count: 1 }])
    })

    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(2)
  })

  it('replaces a tile an older build wrote, rather than double counting it', () => {
    // The previous generation already counted every activity once. Adding to
    // it would count them twice, and no later sweep could undo that.
    const merged = mergeTileDelta({
      existingSegments: existing,
      existingVersion: 6,
      buildVersion: 7,
      delta: buildEdges([{ a: [0, 0], b: [1, 1], count: 1 }])
    })

    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(1)
  })

  it('keeps edges the delta did not touch when adding', () => {
    const merged = mergeTileDelta({
      existingSegments: [
        { count: 1, points: [0, 0, 1, 1] },
        { count: 4, points: [8, 8, 9, 9] }
      ],
      existingVersion: 3,
      buildVersion: 3,
      delta: buildEdges([{ a: [0, 0], b: [1, 1], count: 2 }])
    })

    const counts = edgeMultiset(merged)
    expect(counts).toHaveLength(2)
    expect(counts.some((entry) => entry.endsWith('=3'))).toBe(true)
    expect(counts.some((entry) => entry.endsWith('=4'))).toBe(true)
  })

  it('drops an older build entirely, including edges the delta never mentions', () => {
    const merged = mergeTileDelta({
      existingSegments: [
        { count: 1, points: [0, 0, 1, 1] },
        { count: 4, points: [8, 8, 9, 9] }
      ],
      existingVersion: 2,
      buildVersion: 3,
      delta: buildEdges([{ a: [0, 0], b: [1, 1], count: 1 }])
    })

    expect(edgeMultiset(merged)).toHaveLength(1)
  })

  it('starts a tile from nothing when the row is empty', () => {
    const merged = mergeTileDelta({
      existingSegments: [],
      existingVersion: 3,
      buildVersion: 3,
      delta: buildEdges([{ a: [0, 0], b: [1, 1], count: 1 }])
    })

    expect(merged).toHaveLength(1)
    expect(merged[0].count).toBe(1)
  })
})
