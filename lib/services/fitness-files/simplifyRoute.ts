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

// Squared distance (in meters²) from point `p` to the segment `a`→`b`, using a
// local equirectangular projection anchored at `refLatRad`. Longitudes are
// scaled by cos(lat) so east-west and north-south distances share one metric
// scale; this is accurate to a fraction of a percent over the few-kilometre
// spans a single route subsegment covers. Distances are compared squared to
// avoid a sqrt per candidate point.
const squaredSegmentDistanceMeters = (
  p: LatLng,
  a: LatLng,
  b: LatLng,
  metersPerDegLng: number
): number => {
  const ax = a.lng * metersPerDegLng
  const ay = a.lat * METERS_PER_DEGREE
  const bx = b.lng * metersPerDegLng
  const by = b.lat * METERS_PER_DEGREE
  const px = p.lng * metersPerDegLng
  const py = p.lat * METERS_PER_DEGREE

  let x = ax
  let y = ay
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy

  if (lengthSquared > 0) {
    // Project p onto the segment and clamp to its endpoints so a point past the
    // end measures to the nearer endpoint, not to the infinite line.
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

  const refLatRad = points[0].lat * DEG_TO_RAD
  const metersPerDegLng = METERS_PER_DEGREE * Math.cos(refLatRad)
  const toleranceSquared = toleranceMeters * toleranceMeters

  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1

  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number]
    let farthestIndex = -1
    let farthestDistance = toleranceSquared

    for (let index = start + 1; index < end; index += 1) {
      const distance = squaredSegmentDistanceMeters(
        points[index],
        points[start],
        points[end],
        metersPerDegLng
      )
      if (distance > farthestDistance) {
        farthestDistance = distance
        farthestIndex = index
      }
    }

    if (farthestIndex !== -1) {
      keep[farthestIndex] = 1
      stack.push([start, farthestIndex])
      stack.push([farthestIndex, end])
    }
  }

  const simplified: T[] = []
  for (let index = 0; index < points.length; index += 1) {
    if (keep[index]) {
      simplified.push(points[index])
    }
  }
  return simplified
}

/**
 * Apply {@link simplifyPoints} to every segment, preserving the
 * `isHiddenByPrivacy` flag and dropping any segment left with fewer than two
 * points. Returns the input array reference unchanged when `toleranceMeters` is
 * not positive so callers can opt out cheaply.
 */
export const simplifySegments = (
  segments: FitnessRouteHeatmapSegment[],
  toleranceMeters: number
): FitnessRouteHeatmapSegment[] => {
  if (toleranceMeters <= 0) {
    return segments
  }

  const simplified: FitnessRouteHeatmapSegment[] = []
  for (const segment of segments) {
    const points = simplifyPoints(segment.points, toleranceMeters)
    if (points.length >= 2) {
      simplified.push({ ...segment, points })
    }
  }
  return simplified
}
