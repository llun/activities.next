import { simplifyPoints } from '@/lib/services/fitness-files/simplifyRoute'
import { TILE_SIZE, projectWebMercator } from '@/lib/utils/webMercator'

import {
  TILE_EXTENT,
  TILE_LADDER_ZOOMS,
  TILE_MAX_ZOOM,
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

/**
 * How many tiles a pair of consecutive points may span, measured at the FINEST
 * zoom, before the recording is treated as jumping rather than travelling.
 *
 * A runaway guard, not a fidelity knob. A single bad GPS fix inside the legal
 * coordinate range — a "null island" `{0, 0}` dropout is the common one, and
 * the parser has no reason to reject it — draws a straight line from the route
 * to that point and back. Geometrically that is one wrong stripe, which is what
 * the untiled heatmap used to cost; here every tile the stripe crosses is a
 * STORED ROW, so one bad fix took a measured ride from 84 tiles to 16,563.
 *
 * Judged ONCE, against `TILE_MAX_ZOOM`, and then applied to every level — which
 * is why it lives in the run split rather than in the per-zoom walk. A tile
 * count only means anything relative to how many tiles exist: the world is 16
 * tiles wide at z4 and 65,536 at z16, so a per-zoom test against a fixed bound
 * cannot fire at all below z10, and the same pair would be travel at z12 and a
 * glitch at z16. That leaves the ladder contradicting itself — a continental
 * line drawn at every zoom a reader is likely to look at, and gone when they
 * zoom in.
 *
 * Pinned to one zoom it is a DISTANCE, scaled by cos(latitude): 1,024 z16 tiles
 * is about 626 km at the equator, 386 km at 52°N and 55 km at 85°N. A tile
 * count is still the right invariant, because what is being bounded is stored
 * rows rather than kilometres — but it does mean the guard is far tighter near
 * the poles, and an Arctic recording logging every few hours could be split
 * where a temperate one would not. Only the interpolated line across an
 * unrecorded gap is ever lost; no recorded point is.
 *
 * 1,024 is measured. The longest genuinely straight road on earth (~150 km of
 * the Eyre Highway) spans 335 tiles and is kept whole. A gap left by a recorder
 * running through a 400 km train journey at 52°N spans 1,116 and is split,
 * which is correct — that is a discontinuity, not travel.
 *
 * The boundary between those falls somewhere around 370-390 km at that
 * latitude, depending on direction and on which earth model the distance is
 * measured with — a 370 km northward gap reads as 1,022 tiles against a WGS84
 * meridian degree and 1,029 against an equatorial one, either side of the cap.
 * That a plausible gap sits inside the measurement noise is the point: this
 * boundary is a judgement about write amplification, not a natural edge, so no
 * single distance near it should be quoted as decisive.
 */
const MAX_TILE_SPAN_AT_FINEST_ZOOM = 1_024

const isFinitePoint = (point: { lat: number; lng: number }) =>
  Number.isFinite(point.lat) && Number.isFinite(point.lng)

/**
 * Whether a pair covers more of the map than travel between two recorded points
 * could, and so is a jump in the recording rather than a journey.
 *
 * One rule, deliberately, because it already subsumes the antimeridian case: a
 * pair straddling the date line projects to opposite edges of the world, which
 * is the largest span there is — measured minimum 32,768 tiles, 32x this cap,
 * at every latitude, since Mercator x does not compress with latitude. A
 * separate longitude test would be a branch nothing could reach, and it was
 * also wrong in both directions: it split `-179.9 -> 180.1`, which normalizes
 * to the same longitude, and missed `179.9 -> 180.1`, which is a real wrap.
 *
 * Judged in projected tiles at the finest zoom — see
 * `MAX_TILE_SPAN_AT_FINEST_ZOOM` for why once, and why not per zoom.
 */
const spansTooManyTiles = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
) => {
  const a = projectWebMercator(from, TILE_MAX_ZOOM)
  const b = projectWebMercator(to, TILE_MAX_ZOOM)
  const span =
    Math.abs(Math.floor(b.x / TILE_SIZE) - Math.floor(a.x / TILE_SIZE)) +
    Math.abs(Math.floor(b.y / TILE_SIZE) - Math.floor(a.y / TILE_SIZE))
  return span > MAX_TILE_SPAN_AT_FINEST_ZOOM
}

/**
 * Breaks a route into the runs that are actually continuous, dropping any point
 * the parser let through with a non-finite coordinate.
 *
 * Splitting here rather than in the per-zoom walk is what keeps the ladder
 * self-consistent: the verdict is reached once, so every level builds from the
 * same runs and no zoom can disagree about whether a stretch of road exists.
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
    if (previous && spansTooManyTiles(previous, point)) {
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

  // Always 1, never accumulated: the dedup above means this edge has not been
  // seen for this activity, and one activity contributes one visit. Counts add
  // up across activities, in the merge, not here.
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
 * pixel space. That plane is anchored at the run's FIRST latitude, so a long
 * north-south activity is simplified against its start's pixel size rather than
 * its far end's. Tolerance scales with cos(latitude), so a run STARTING nearer
 * the equator carries the coarser tolerance into a far end whose pixels are
 * finer — under-detailed travelling poleward, over-detailed travelling
 * equatorward, and so not invariant to reversing the run. The error is a
 * cos(latitude) ratio and stays small over any real activity; it never affects
 * where a point LANDS, because placement projects each point exactly.
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
