import type { FitnessRouteHeatmapSegment } from '@/lib/types/database/fitnessRouteHeatmap'

// Shape-preserving line simplification (Ramer–Douglas–Peucker) for GPS routes.
//
// Uniform decimation (keeping every Nth point) is cheap but destroys road
// fidelity: it drops the vertices that describe a curve just as readily as the
// redundant samples on a straight stretch, so a zoomed-in line cuts across the
// corners of the road. Douglas–Peucker instead keeps the vertices whose
// perpendicular distance from the simplified line exceeds a tolerance, so a
// straight segment collapses toward its two endpoints while bends keep the
// detail needed to trace the road. At the same vertex budget this packs far more
// usable fidelity, and the tolerance is expressed in meters so it maps directly
// to "how far off the road may the rendered line stray".

interface LatLng {
  lat: number
  lng: number
}

const EARTH_RADIUS_METERS = 6_371_000
const DEG_TO_RAD = Math.PI / 180
const METERS_PER_DEGREE = EARTH_RADIUS_METERS * DEG_TO_RAD

// Provable upper bound on RDP work, as a multiple of the vertex count. Exact RDP
// is ~O(n log n) on real GPS tracks (each split's farthest vertex sits near the
// middle, so the recursion stays balanced), but it degrades to O(n²) on a
// pathological alternating sawtooth whose teeth all sit just above the tolerance
// — the recursion peels one vertex at a time. Fitness files are user-uploaded
// (a 50 MB GPX can hold ~1M points), so such an input is a cheap worker DoS
// without a guard. This cap (well above any real track's balanced cost) bounds
// the total perpendicular-distance comparisons; if it is exhausted, the loop
// stops subdividing and the already-marked vertices still form a valid,
// endpoint-preserving simplification.
const MAX_COMPARISONS_PER_POINT = 128

// Max times the adaptive budget fit doubles the tolerance. Geometric growth means
// a handful of passes spans a huge tolerance range (e.g. 1m → 256m after 8 passes
// collapses almost everything), so this is only a runaway guard — it bounds the
// adaptive cost at O(passes · n), never trimming a realistic region's detail
// before it fits.
export const MAX_BUDGET_PASSES = 8

const totalPointCount = (
  segments: ReadonlyArray<{ points: ReadonlyArray<unknown> }>
): number => segments.reduce((sum, segment) => sum + segment.points.length, 0)

// Squared distance (in meters²) from a point to the segment `a`→`b`, all already
// projected to the local equirectangular meters plane (see simplifyPoints).
// Distances are compared squared to avoid a sqrt per candidate point.
const squaredSegmentDistance = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  let x = ax
  let y = ay
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared > 0) {
    // Project the point onto the segment and clamp to its endpoints so a point
    // past the end measures to the nearer endpoint, not to the infinite line.
    const t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared
    if (t > 1) {
      x = bx
      y = by
    } else if (t > 0) {
      x = ax + t * dx
      y = ay + t * dy
    }
  }

  const ex = px - x
  const ey = py - y
  return ex * ex + ey * ey
}

/**
 * Simplify a polyline with Ramer–Douglas–Peucker, keeping every vertex whose
 * perpendicular distance from the retained line exceeds `toleranceMeters`. The
 * first and last vertices are always preserved, so the simplified route spans
 * the same extent. Runs iteratively (an explicit stack) so a very long route
 * cannot overflow the call stack.
 *
 * Returns the input array unchanged when there is nothing to simplify
 * (`toleranceMeters <= 0`, or two or fewer points).
 */
export const simplifyPoints = <T extends LatLng>(
  points: T[],
  toleranceMeters: number
): T[] => {
  if (toleranceMeters <= 0 || points.length <= 2) {
    return points
  }

  // Project every vertex once into a local equirectangular meters plane,
  // anchored at the first point's latitude (cos(lat) scales longitude so the two
  // axes share one metric scale). Doing it up front keeps the inner loop free of
  // repeated trig/projection and property lookups — it would otherwise re-project
  // each subsegment's endpoints on every comparison.
  const length = points.length
  const refLatRad = points[0].lat * DEG_TO_RAD
  const metersPerDegLng = METERS_PER_DEGREE * Math.cos(refLatRad)
  const toleranceSquared = toleranceMeters * toleranceMeters

  const xs = new Float64Array(length)
  const ys = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    xs[index] = points[index].lng * metersPerDegLng
    ys[index] = points[index].lat * METERS_PER_DEGREE
  }

  const keep = new Uint8Array(length)
  keep[0] = 1
  keep[length - 1] = 1

  // Bounds total comparisons so a pathological input cannot run in O(n²); see
  // MAX_COMPARISONS_PER_POINT. Never trips for real tracks.
  let comparisonsRemaining = length * MAX_COMPARISONS_PER_POINT
  // Flat [start, end, start, end, …] stack: pushing two numbers instead of a
  // tuple array avoids per-subsegment allocation (and GC churn) in this hot loop
  // while keeping the exact same DFS order.
  const stack: number[] = [0, length - 1]
  while (stack.length > 0) {
    const end = stack.pop() as number
    const start = stack.pop() as number
    const ax = xs[start]
    const ay = ys[start]
    const bx = xs[end]
    const by = ys[end]
    let farthestIndex = -1
    let farthestDistance = toleranceSquared

    for (let index = start + 1; index < end; index += 1) {
      const distance = squaredSegmentDistance(
        xs[index],
        ys[index],
        ax,
        ay,
        bx,
        by
      )
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthestIndex = index
      }
    }

    comparisonsRemaining -= end - start - 1
    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1
      // Only recurse into a side that still has an interior vertex to test.
      if (farthestIndex - start > 1) {
        stack.push(start, farthestIndex)
      }
      if (end - farthestIndex > 1) {
        stack.push(farthestIndex, end)
      }
    }

    // Budget exhausted: stop subdividing. Endpoints and every vertex marked so
    // far are retained, so the result is still a valid (if coarser in the
    // unprocessed spans) endpoint-preserving simplification.
    if (comparisonsRemaining <= 0) {
      break
    }
  }

  const simplified: T[] = []
  for (let index = 0; index < length; index += 1) {
    if (keep[index]) {
      simplified.push(points[index])
    }
  }
  // Nothing was dropped: return the original reference so the downstream
  // reference-preserving fast paths (and the RouteHeatmapMap useMemo) hold.
  return simplified.length === length ? points : simplified
}

/**
 * Apply {@link simplifyPoints} to every segment, preserving the
 * `isHiddenByPrivacy` flag and dropping any segment left with fewer than two
 * points. Returns the input array reference unchanged when nothing changed (or
 * `toleranceMeters` is not positive), so callers — e.g. the `useMemo` in
 * `RouteHeatmapMap` — can keep a stable identity and skip downstream work.
 */
export const simplifySegments = (
  segments: FitnessRouteHeatmapSegment[],
  toleranceMeters: number
): FitnessRouteHeatmapSegment[] => {
  if (toleranceMeters <= 0) {
    return segments
  }

  const simplified: FitnessRouteHeatmapSegment[] = []
  let changed = false
  for (const segment of segments) {
    const points = simplifyPoints(segment.points, toleranceMeters)
    if (points.length < 2) {
      changed = true
      continue
    }
    if (points === segment.points) {
      simplified.push(segment)
    } else {
      changed = true
      simplified.push({ ...segment, points })
    }
  }
  return changed ? simplified : segments
}

/**
 * Simplify segments to at most `maxPoints` vertices while preserving road shape.
 *
 * Starts at the finest `baseToleranceMeters` (max granularity) and, only if the
 * result still exceeds the budget, geometrically coarsens the tolerance and
 * re-simplifies the ORIGINAL segments until it fits (or {@link MAX_BUDGET_PASSES}
 * is reached). Every pass is Douglas–Peucker, so the output is always
 * shape-preserving — a dense region is coarsened (still following the road)
 * rather than uniformly decimated (which cuts corners). Returns the input
 * reference when the base pass already fits and changes nothing.
 *
 * This is a best-effort target, not a hard ceiling: callers that need a strict
 * cap should still apply a final uniform fallback (e.g. `downsampleSegments`),
 * which now only triggers for pathological many-tiny-segment inputs.
 */
export const simplifySegmentsToBudget = (
  segments: FitnessRouteHeatmapSegment[],
  maxPoints: number,
  baseToleranceMeters: number
): FitnessRouteHeatmapSegment[] => {
  if (baseToleranceMeters <= 0) {
    return segments
  }

  let tolerance = baseToleranceMeters
  let result = simplifySegments(segments, tolerance)
  for (
    let pass = 0;
    pass < MAX_BUDGET_PASSES && totalPointCount(result) > maxPoints;
    pass += 1
  ) {
    tolerance *= 2
    result = simplifySegments(segments, tolerance)
  }
  return result
}
