import { simplifyPoints } from '@/lib/services/fitness-files/simplifyRoute'
import { TILE_SIZE, projectWebMercator } from '@/lib/utils/webMercator'

import {
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  tileToleranceMeters
} from './constants'
import type { TileEdgeMap } from './edgeMerge'
import { edgeKey, packVertex } from './edgeMerge'
import { tileCountAtZoom, tileKey } from './tileCodec'

/**
 * Turns one activity's route into the per-tile edges it contributes, at every
 * zoom in the ladder.
 *
 * Pure and dependency-free apart from the shared projection and simplification
 * helpers; no `'use client'`, no environment (see AGENTS.md → Server/Client
 * Module Boundary). The simplification floor arrives as a plain number from
 * whichever server caller read it from config.
 */

/** A privacy-classified run of an activity's route, as `buildPrivacySegments` emits. */
export interface TilerSegment {
  isHiddenByPrivacy: boolean
  points: Array<{ lat: number; lng: number }>
}

export interface TileDelta {
  z: number
  x: number
  y: number
  edges: TileEdgeMap
}

/** Longitude jump treated as a recording discontinuity rather than travel. */
const ANTIMERIDIAN_JUMP_DEGREES = 180

const isFinitePoint = (point: { lat: number; lng: number }) =>
  Number.isFinite(point.lat) && Number.isFinite(point.lng)

/**
 * Splits a run wherever consecutive points jump the antimeridian.
 *
 * Without this, a pair straddling the date line projects to opposite edges of
 * the world and the boundary walk below would lay edges across every tile
 * column between them. Measured on the ORIGINAL longitudes, before projection
 * normalizes them, because that is where the jump is visible.
 *
 * Only longitude wrap is caught. A GPS teleport in latitude, or a longitude
 * glitch under 180°, still draws a straight line of edges through whatever it
 * crosses; the parsers reject non-finite values but do not detect teleports,
 * and inventing a distance threshold here would silently cut legitimate gaps
 * in sparse recordings.
 */
const splitAtDiscontinuities = (
  points: Array<{ lat: number; lng: number }>
) => {
  const runs: Array<Array<{ lat: number; lng: number }>> = []
  let current: Array<{ lat: number; lng: number }> = []

  for (const point of points) {
    if (!isFinitePoint(point)) {
      if (current.length >= 2) runs.push(current)
      current = []
      continue
    }

    const previous = current[current.length - 1]
    if (
      previous &&
      Math.abs(point.lng - previous.lng) >= ANTIMERIDIAN_JUMP_DEGREES
    ) {
      if (current.length >= 2) runs.push(current)
      current = [point]
      continue
    }

    current.push(point)
  }

  if (current.length >= 2) runs.push(current)
  return runs
}

/**
 * Every parameter along `p0 -> p1` at which it crosses an integer tile
 * boundary, on either axis, in ascending order and without duplicates.
 *
 * A pair is only ever inside one tile between two consecutive crossings, so
 * cutting here is what lets a steep diagonal contribute to EVERY tile it
 * passes through rather than just its two endpoints'.
 */
const boundaryCrossings = (
  p0: { x: number; y: number },
  p1: { x: number; y: number }
) => {
  const crossings: number[] = []

  const collect = (from: number, to: number) => {
    if (from === to) return
    const step = to > from ? 1 : -1
    // The first boundary strictly beyond `from`, walking towards `to`.
    let boundary = step > 0 ? Math.floor(from) + 1 : Math.ceil(from) - 1
    while (step > 0 ? boundary < to : boundary > to) {
      crossings.push((boundary - from) / (to - from))
      boundary += step
    }
  }

  collect(p0.x, p1.x)
  collect(p0.y, p1.y)

  return [...new Set(crossings)]
    .filter((t) => t > 0 && t < 1)
    .sort((a, b) => a - b)
}

/**
 * Folds one sub-edge — already known to lie within a single tile — into the
 * delta map.
 *
 * Both endpoints are localized from the CONTINUOUS frame by subtracting the
 * integer tile origin, which is exact. That is what makes a boundary vertex
 * shared: a crossing solved once at continuous `(k, Yc)` becomes local 256 in
 * the left tile and local 0 in the right, and both take their other coordinate
 * from the identical `Yc`, so the two round to the same pixel and no seam
 * opens. Re-solving the crossing inside each tile's own shifted frame would be
 * mathematically equal but numerically different in the last bit, which is
 * exactly how an intermittent one-pixel seam appears.
 */
const foldSubEdge = (
  deltas: Map<string, TileDelta>,
  activityEdges: Set<string>,
  zoom: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  hidden: boolean
) => {
  const lastTile = tileCountAtZoom(zoom) - 1
  const clampIndex = (index: number) => Math.min(Math.max(index, 0), lastTile)

  // Which tile owns the sub-edge is decided by a point strictly inside it, so a
  // crossing that lands exactly on a corner cannot be attributed to one of the
  // two tiles it merely touches.
  const midX = (from.x + to.x) / 2
  const midY = (from.y + to.y) / 2
  const tileX = clampIndex(Math.floor(midX))
  const tileY = clampIndex(Math.floor(midY))

  const localize = (value: number, origin: number) => {
    const local = Math.round((value - origin) * TILE_EXTENT)
    return Math.min(Math.max(local, 0), TILE_EXTENT)
  }

  const a = packVertex(localize(from.x, tileX), localize(from.y, tileY))
  const b = packVertex(localize(to.x, tileX), localize(to.y, tileY))
  // Both ends quantized onto the same pixel: no length, nothing to draw.
  if (a === b) return

  const key = edgeKey(a, b, hidden)
  // Per ACTIVITY, not per pair: an out-and-back along one street, or a lap
  // repeated within a single ride, is one visit. Counting each traversal would
  // make heat depend on how an activity happened to be routed rather than on
  // how often the street is used, and would be unstable under GPS jitter.
  const activityKey = `${zoom}:${tileX}:${tileY}:${key}`
  if (activityEdges.has(activityKey)) return
  activityEdges.add(activityKey)

  const mapKey = tileKey(zoom, tileX, tileY)
  let delta = deltas.get(mapKey)
  if (!delta) {
    delta = { z: zoom, x: tileX, y: tileY, edges: new Map() }
    deltas.set(mapKey, delta)
  }

  const existing = delta.edges.get(key)
  if (existing) {
    existing.count += 1
    return
  }
  delta.edges.set(key, {
    a: Math.min(a, b),
    b: Math.max(a, b),
    hidden,
    count: 1
  })
}

export interface BuildTileDeltasParams {
  segments: TilerSegment[]
  /** Defaults to the full ladder; narrowed only by tests. */
  ladderZooms?: readonly number[]
  /** Finest simplification tolerance, in meters — the caller's config floor. */
  toleranceFloorMeters: number
}

/**
 * The tiler.
 *
 * For each zoom, DESCENDING, the route is simplified to that zoom's own pixel
 * and the result feeds the next coarser level — a cascade, so the seven levels
 * together cost little more than the finest one. Each level re-simplifies from
 * the level above rather than from the original, which bounds the worst-case
 * deviation at the coarsest level to 4/3 of its own tolerance (the tolerances
 * grow about fourfold per step, so the series sums to 4/3) — a small constant,
 * and in exchange each level's input is already a fraction of the raw track.
 *
 * The tolerance is a distance in METERS because that is what `simplifyPoints`
 * takes: it projects into a local meters plane internally and cannot be run in
 * pixel space. Anchoring that plane at the run's first latitude leaves a long
 * north-south activity slightly over-detailed at its far end, which errs
 * towards keeping shape; it never affects where a point LANDS, since placement
 * projects each point exactly.
 */
export const buildTileDeltasForActivity = ({
  segments,
  ladderZooms = TILE_LADDER_ZOOMS,
  toleranceFloorMeters
}: BuildTileDeltasParams): Map<string, TileDelta> => {
  const deltas = new Map<string, TileDelta>()
  const activityEdges = new Set<string>()

  for (const segment of segments) {
    const hidden = Boolean(segment.isHiddenByPrivacy)

    for (const run of splitAtDiscontinuities(segment.points)) {
      const referenceLatitude = run[0].lat
      let simplified = run

      // Descending, so each level simplifies the level above it.
      for (const zoom of [...ladderZooms].sort((a, b) => b - a)) {
        simplified = simplifyPoints(
          simplified,
          tileToleranceMeters(zoom, referenceLatitude, toleranceFloorMeters)
        )
        if (simplified.length < 2) break

        const projected = simplified.map((point) => {
          const { x, y } = projectWebMercator(point, zoom)
          return { x: x / TILE_SIZE, y: y / TILE_SIZE }
        })

        for (let index = 0; index + 1 < projected.length; index += 1) {
          const from = projected[index]
          const to = projected[index + 1]
          if (
            !Number.isFinite(from.x) ||
            !Number.isFinite(from.y) ||
            !Number.isFinite(to.x) ||
            !Number.isFinite(to.y)
          ) {
            continue
          }

          // Solved once here, in the continuous frame, then localized per tile.
          const crossings = boundaryCrossings(from, to)
          let cursor = from

          for (const t of crossings) {
            const at = {
              x: from.x + (to.x - from.x) * t,
              y: from.y + (to.y - from.y) * t
            }
            foldSubEdge(deltas, activityEdges, zoom, cursor, at, hidden)
            cursor = at
          }

          foldSubEdge(deltas, activityEdges, zoom, cursor, to, hidden)
        }
      }
    }
  }

  return deltas
}
