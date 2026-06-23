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

  const stack: Array<[number, number]> = [[0, length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
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

    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1
      // Only recurse into a side that still has an interior vertex to test.
      if (farthestIndex - start > 1) {
        stack.push([start, farthestIndex])
      }
      if (end - farthestIndex > 1) {
        stack.push([farthestIndex, end])
      }
    }
  }

  const simplified: T[] = []
  for (let index = 0; index < length; index += 1) {
    if (keep[index]) {
      simplified.push(points[index])
    }
  }
  return simplified
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
