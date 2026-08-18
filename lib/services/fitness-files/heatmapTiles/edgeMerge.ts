import { TILE_EXTENT } from './constants'
import type { TileSegment } from './tileCodec'

/**
 * Turning a tile between its two representations: the polylines it is stored
 * as, and the edge set the build accumulates into.
 *
 * Pure and dependency-free, no `'use client'` (see AGENTS.md → Server/Client
 * Module Boundary).
 */

/**
 * One quantized pixel, packed into a single integer so it can key a Map.
 *
 * Base `TILE_EXTENT + 1`, not `TILE_EXTENT`. The coordinate space is inclusive
 * of both ends — 0..256 is 257 distinct values, because a point exactly on a
 * tile's far boundary is 256 here and 0 in the neighbour — so base 256 would
 * collide (1,0) with (0,256) and silently weld two unrelated streets together.
 */
export const VERTEX_PACK_BASE = TILE_EXTENT + 1

export const packVertex = (x: number, y: number) => x * VERTEX_PACK_BASE + y

export const unpackVertex = (packed: number) => ({
  x: Math.floor(packed / VERTEX_PACK_BASE),
  y: packed % VERTEX_PACK_BASE
})

/**
 * An undirected edge between two packed vertices, with its privacy class.
 *
 * Undirected because which way an activity happened to travel a street is not
 * something a heatmap shows — normalizing means an out-and-back and two
 * opposite commutes land on the same edge instead of two. The privacy class is
 * part of the identity so trimmed geometry can never merge into visible
 * geometry: they render differently, and a run has only one class.
 */
export const edgeKey = (a: number, b: number, hidden: boolean) =>
  `${Math.min(a, b)}:${Math.max(a, b)}:${hidden ? 1 : 0}`

export interface TileEdge {
  a: number
  b: number
  hidden: boolean
  count: number
}

export type TileEdgeMap = Map<string, TileEdge>

/**
 * Breaks stored polylines back into the edges they are made of, summing the
 * counts of any edge that appears more than once.
 */
export const explodeTileToEdges = (segments: TileSegment[]): TileEdgeMap => {
  const edges: TileEdgeMap = new Map()

  for (const segment of segments) {
    const hidden = Boolean(segment.hidden)
    const { points } = segment

    for (let index = 0; index + 3 < points.length; index += 2) {
      const a = packVertex(points[index], points[index + 1])
      const b = packVertex(points[index + 2], points[index + 3])
      // A polyline should never contain one, but a hand-written or
      // partially-corrupt payload can; a self-loop is not geometry.
      if (a === b) continue

      const key = edgeKey(a, b, hidden)
      const existing = edges.get(key)
      if (existing) {
        existing.count += segment.count
        continue
      }
      edges.set(key, {
        a: Math.min(a, b),
        b: Math.max(a, b),
        hidden,
        count: segment.count
      })
    }
  }

  return edges
}

interface AdjacencyEntry {
  to: number
  edgeIndex: number
}

/**
 * Reassembles an edge set into the longest polylines that can carry it.
 *
 * Two rules make this lossless, and both are load-bearing:
 *
 * 1. **Partition by `(count, hidden)` first.** A stored polyline carries ONE
 *    count and one privacy class for all of its points, so an edge visited
 *    twice and an edge visited once cannot share a run — putting them together
 *    would have to pick a count, and whichever it picked would be wrong for the
 *    other.
 * 2. **Sweep for cycles after the odd-degree starts.** Walking only from
 *    odd-degree vertices is the compact choice, but a closed loop — a
 *    roundabout, a lap, a criterium circuit — has no odd-degree vertex at all,
 *    so a walk that only starts at one never enters it and every edge in it is
 *    silently dropped.
 *
 * Correctness needs completeness (every edge consumed exactly once), not
 * minimality: a walk that dead-ends at a junction just ends that run, and the
 * sweep picks up the rest. Consumption is by flag with per-vertex adjacency, so
 * the whole pass is linear in the number of edges — a dense downtown tile is
 * not capped, so an O(E^2) assembler would be a real cliff.
 */
export const assembleEdgesToSegments = (edges: TileEdgeMap): TileSegment[] => {
  const partitions = new Map<string, TileEdge[]>()
  for (const edge of edges.values()) {
    const partitionKey = `${edge.count}:${edge.hidden ? 1 : 0}`
    const partition = partitions.get(partitionKey)
    if (partition) partition.push(edge)
    else partitions.set(partitionKey, [edge])
  }

  const segments: TileSegment[] = []

  for (const partition of partitions.values()) {
    const adjacency = new Map<number, AdjacencyEntry[]>()
    const consumed = new Array<boolean>(partition.length).fill(false)

    const link = (from: number, to: number, edgeIndex: number) => {
      const entries = adjacency.get(from)
      if (entries) entries.push({ to, edgeIndex })
      else adjacency.set(from, [{ to, edgeIndex }])
    }

    partition.forEach((edge, edgeIndex) => {
      link(edge.a, edge.b, edgeIndex)
      link(edge.b, edge.a, edgeIndex)
    })

    // A cursor per vertex, so skipping already-consumed edges never rescans
    // from the start of its adjacency list.
    const cursors = new Map<number, number>()
    const nextUnconsumed = (vertex: number) => {
      const entries = adjacency.get(vertex)
      if (!entries) return null

      let cursor = cursors.get(vertex) ?? 0
      while (cursor < entries.length && consumed[entries[cursor].edgeIndex]) {
        cursor += 1
      }
      cursors.set(vertex, cursor)
      return cursor < entries.length ? entries[cursor] : null
    }

    const walkFrom = (start: number) => {
      const path = [start]
      let current = start

      for (;;) {
        const next = nextUnconsumed(current)
        if (!next) break
        consumed[next.edgeIndex] = true
        path.push(next.to)
        current = next.to
      }

      if (path.length < 2) return
      const { count, hidden } = partition[0]
      const points: number[] = []
      for (const packed of path) {
        const { x, y } = unpackVertex(packed)
        points.push(x, y)
      }
      segments.push({ count, ...(hidden ? { hidden: true } : {}), points })
    }

    // Odd-degree vertices first: starting there produces fewer, longer runs.
    for (const [vertex, entries] of adjacency) {
      if (entries.length % 2 === 1) walkFrom(vertex)
    }

    // Then whatever is left, which is exactly the closed loops the pass above
    // cannot reach. Without this they would be dropped outright.
    for (let edgeIndex = 0; edgeIndex < partition.length; edgeIndex += 1) {
      if (!consumed[edgeIndex]) walkFrom(partition[edgeIndex].a)
    }
  }

  return segments
}

/**
 * Folds a build's freshly-computed edges into whatever the tile already holds.
 *
 * The version decides whether that is addition or replacement. A row written by
 * THIS build is this build's own earlier flush, so its counts are added to.
 * A row written by an older build is the previous generation's answer, and this
 * build is replacing it — adding there would count every activity twice, once
 * per build, and the error would be permanent.
 */
export const mergeTileDelta = ({
  existingSegments,
  existingVersion,
  buildVersion,
  delta
}: {
  existingSegments: TileSegment[]
  existingVersion: number
  buildVersion: number
  delta: TileEdgeMap
}): TileSegment[] => {
  if (existingVersion !== buildVersion) {
    return assembleEdgesToSegments(delta)
  }

  const merged = explodeTileToEdges(existingSegments)
  for (const [key, edge] of delta) {
    const existing = merged.get(key)
    if (existing) {
      existing.count += edge.count
      continue
    }
    merged.set(key, { ...edge })
  }

  return assembleEdgesToSegments(merged)
}
