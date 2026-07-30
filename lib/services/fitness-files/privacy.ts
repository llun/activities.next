// MUST stay sorted ascending — `sanitizePrivacyRadiusMeters` snaps upwards by
// taking the first option that clears the input. `0` means "no privacy zone".
// 50m is the smallest zone worth having: consumer GPS drifts by tens of metres,
// so anything tighter leaves the start/finish of a route pinned to the doorstep
// it was meant to hide. `privacy.test.ts` enforces both invariants.
export const FITNESS_PRIVACY_RADIUS_OPTIONS = [
  0, 50, 100, 200, 500, 1000
] as const

export type FitnessPrivacyRadiusMeters =
  (typeof FITNESS_PRIVACY_RADIUS_OPTIONS)[number]

// Derived, not a second literal: a hand-maintained copy would silently cap
// below a newly added option.
export const MAX_FITNESS_PRIVACY_RADIUS_METERS =
  FITNESS_PRIVACY_RADIUS_OPTIONS[FITNESS_PRIVACY_RADIUS_OPTIONS.length - 1]

interface Coordinate {
  lat: number
  lng: number
}

interface PrivacySettingsInput {
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number | null
  privacyLocations?: unknown
}

export interface FitnessPrivacyLocationSetting {
  latitude: number
  longitude: number
  hideRadiusMeters: FitnessPrivacyRadiusMeters
}

export interface FitnessPrivacyLocation {
  lat: number
  lng: number
  radiusMeters: FitnessPrivacyRadiusMeters
}

export interface PrivacySegment<T> {
  isHiddenByPrivacy: boolean
  points: T[]
}

const EARTH_RADIUS_METERS = 6_371_000

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const sanitizePrivacyRadiusMeters = (
  value: unknown
): FitnessPrivacyRadiusMeters => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }

  // Snap an unlisted radius up to the next supported option rather than
  // dropping it to 0. Zones saved under the older, smaller option set (5m,
  // 10m, 20m) would otherwise silently stop hiding anything.
  return (
    FITNESS_PRIVACY_RADIUS_OPTIONS.find((option) => option >= value) ??
    MAX_FITNESS_PRIVACY_RADIUS_METERS
  )
}

const sanitizeLatitude = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  if (value < -90 || value > 90) {
    return null
  }

  return value
}

const sanitizeLongitude = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  if (value < -180 || value > 180) {
    return null
  }

  return value
}

const sanitizePrivacyLocationSetting = (
  value: unknown
): FitnessPrivacyLocationSetting | null => {
  if (!value || typeof value !== 'object') {
    return null
  }

  const location = value as {
    latitude?: unknown
    longitude?: unknown
    hideRadiusMeters?: unknown
  }

  const latitude = sanitizeLatitude(location.latitude)
  const longitude = sanitizeLongitude(location.longitude)
  const hideRadiusMeters = sanitizePrivacyRadiusMeters(
    location.hideRadiusMeters
  )

  if (latitude === null || longitude === null || hideRadiusMeters <= 0) {
    return null
  }

  return {
    latitude,
    longitude,
    hideRadiusMeters
  }
}

export const sanitizePrivacyLocationSettings = (
  value: unknown
): FitnessPrivacyLocationSetting[] => {
  if (!Array.isArray(value)) {
    return []
  }

  const seenKeys = new Set<string>()
  const locations: FitnessPrivacyLocationSetting[] = []

  for (const item of value) {
    const location = sanitizePrivacyLocationSetting(item)
    if (!location) {
      continue
    }

    const dedupeLatitude = location.latitude.toFixed(6)
    const dedupeLongitude = location.longitude.toFixed(6)
    const key = `${dedupeLatitude}:${dedupeLongitude}:${location.hideRadiusMeters}`
    if (seenKeys.has(key)) {
      continue
    }

    seenKeys.add(key)
    locations.push(location)
  }

  return locations
}

const getLegacyFitnessPrivacyLocation = (
  settings: PrivacySettingsInput | null | undefined
): FitnessPrivacyLocation | null => {
  if (!settings) {
    return null
  }

  const radiusMeters = sanitizePrivacyRadiusMeters(
    settings.privacyHideRadiusMeters
  )

  if (radiusMeters <= 0) {
    return null
  }

  const lat = sanitizeLatitude(settings.privacyHomeLatitude)
  const lng = sanitizeLongitude(settings.privacyHomeLongitude)

  if (lat === null || lng === null) {
    return null
  }

  return {
    lat,
    lng,
    radiusMeters
  }
}

export const getFitnessPrivacyLocations = (
  settings: PrivacySettingsInput | null | undefined
): FitnessPrivacyLocation[] => {
  if (!settings) {
    return []
  }

  const privacyLocations = sanitizePrivacyLocationSettings(
    settings.privacyLocations
  )
  if (privacyLocations.length > 0) {
    return privacyLocations.map((location) => ({
      lat: location.latitude,
      lng: location.longitude,
      radiusMeters: location.hideRadiusMeters
    }))
  }

  const legacyLocation = getLegacyFitnessPrivacyLocation(settings)
  return legacyLocation ? [legacyLocation] : []
}

export const getDistanceMeters = (
  first: Coordinate,
  second: Coordinate
): number => {
  const dLat = toRadians(second.lat - first.lat)
  const dLng = toRadians(second.lng - first.lng)
  const lat1 = toRadians(first.lat)
  const lat2 = toRadians(second.lat)

  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2

  const clampedHaversine = Math.max(0, Math.min(1, haversine))
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(clampedHaversine))
}

// Inside the circle, not "hidden": a zone decides where a route may START and
// END, so a point inside one mid-route is still shown. Keep the two ideas named
// apart — conflating them is exactly the bug this module used to have.
export const isPointInsidePrivacyLocation = (
  point: Coordinate,
  privacyLocation: FitnessPrivacyLocation | null
): boolean => {
  if (!privacyLocation) {
    return false
  }

  const distance = getDistanceMeters(point, privacyLocation)
  return distance <= privacyLocation.radiusMeters
}

const normalizePrivacyLocations = (
  privacyLocation:
    FitnessPrivacyLocation | FitnessPrivacyLocation[] | null | undefined
): FitnessPrivacyLocation[] => {
  if (!privacyLocation) {
    return []
  }

  const privacyLocations = Array.isArray(privacyLocation)
    ? privacyLocation
    : [privacyLocation]

  // A zero-radius zone is no zone. `getFitnessPrivacyLocations` never emits one,
  // but callers may pass their own, and without this a point sitting exactly on
  // such a centre would count as "inside" (`distance <= 0`) while contributing a
  // hide length of 0 — so it could block a trim candidate that nothing ever
  // asked to trim.
  return privacyLocations.filter((location) => location.radiusMeters > 0)
}

export const isPointInsideAnyPrivacyLocation = (
  point: Coordinate,
  privacyLocations: FitnessPrivacyLocation[] | null | undefined
): boolean => {
  if (!privacyLocations || privacyLocations.length === 0) {
    return false
  }

  return privacyLocations.some((privacyLocation) => {
    return isPointInsidePrivacyLocation(point, privacyLocation)
  })
}

// How much route one end of the track must give up: the radius of the largest
// zone that contains it, or 0 when that end sits in no zone at all. Returning 0
// is what makes the two ends independent — a point-to-point ride that starts at
// home and finishes elsewhere loses its head and keeps every metre of its tail.
const getAnchorHideLengthMeters = (
  point: Coordinate,
  privacyLocations: FitnessPrivacyLocation[]
): number => {
  let hideLengthMeters = 0

  for (const privacyLocation of privacyLocations) {
    if (!isPointInsidePrivacyLocation(point, privacyLocation)) {
      continue
    }

    hideLengthMeters = Math.max(hideLengthMeters, privacyLocation.radiusMeters)
  }

  return hideLengthMeters
}

// Walks inward from one end of the track and returns the first index that has
// both cleared every zone and travelled the anchor zone's radius from that end.
// `step` is +1 walking from the first point, -1 walking back from the last.
//
// Distance is cumulative along the route, not straight-line from the anchor,
// because the radius is being spent as a LENGTH of route here — that is what the
// settings copy promises. Note which way that cuts: cumulative distance is
// always >= the crow-flies distance, so it clears the threshold sooner. A route
// that winds near home banks metres while staying close to it, and a
// circumferential route around a large zone clears the length before a radial
// one does. The zone circle is what stops that becoming an exposure: a point
// only qualifies once it is outside every zone as well.
const findFirstUnhiddenIndex = <T extends Coordinate>(
  points: T[],
  privacyLocations: FitnessPrivacyLocation[],
  step: 1 | -1
): number | null => {
  const anchorIndex = step === 1 ? 0 : points.length - 1
  const hideLengthMeters = getAnchorHideLengthMeters(
    points[anchorIndex],
    privacyLocations
  )

  if (hideLengthMeters <= 0) {
    return anchorIndex
  }

  let travelledMeters = 0

  for (
    let index = anchorIndex + step;
    index >= 0 && index < points.length;
    index += step
  ) {
    travelledMeters += getDistanceMeters(points[index - step], points[index])

    if (travelledMeters < hideLengthMeters) {
      continue
    }

    if (isPointInsideAnyPrivacyLocation(points[index], privacyLocations)) {
      continue
    }

    return index
  }

  // Never got far enough away — a treadmill trace, a lap session that stays in
  // the park across the road, or a route wholly inside a zone. Nothing to show.
  return null
}

export interface PrivacyVisibleRange {
  firstVisibleIndex: number
  lastVisibleIndex: number
}

/**
 * The window of an ordered track that may be shown to other viewers, or `null`
 * when none of it may be.
 *
 * A privacy zone only ever trims the HEAD and the TAIL of a route; the middle is
 * never cut. The radius does double duty — it is both the area test (does the
 * activity start, or finish, inside the circle?) and the length of route hidden
 * from that end.
 *
 * The middle stays whole even where it passes back through a zone. That is a
 * deliberate trade: a circular gap punched into a polyline localises the zone's
 * centre far more precisely than the line through it ever would, and the ends of
 * an activity are where the address worth hiding actually is. Cutting at every
 * crossing also broke the drawing into disconnected polylines, which is the
 * complaint this replaced.
 */
export const getPrivacyVisibleRange = <T extends Coordinate>(
  points: T[],
  privacyLocation:
    FitnessPrivacyLocation | FitnessPrivacyLocation[] | null | undefined
): PrivacyVisibleRange | null => {
  if (points.length === 0) {
    return null
  }

  const privacyLocations = normalizePrivacyLocations(privacyLocation)
  if (privacyLocations.length === 0) {
    return { firstVisibleIndex: 0, lastVisibleIndex: points.length - 1 }
  }

  const firstVisibleIndex = findFirstUnhiddenIndex(points, privacyLocations, 1)
  if (firstVisibleIndex === null) {
    return null
  }

  const lastVisibleIndex = findFirstUnhiddenIndex(points, privacyLocations, -1)
  if (lastVisibleIndex === null) {
    return null
  }

  // The two trims crossed: everything the route has is within one radius of an
  // end that has to be hidden. Trims that meet exactly leave `first === last`,
  // a one-point window — deliberately not rejected here, because the same
  // condition arises for a legitimate single-point track that no zone touches.
  // `getVisibleSegments` reports it as nothing drawable, which is the answer
  // every caller that renders a line needs.
  if (firstVisibleIndex > lastVisibleIndex) {
    return null
  }

  return { firstVisibleIndex, lastVisibleIndex }
}

/**
 * `points` MUST be one activity's track, in recorded order. This is no longer a
 * per-point predicate: the flag is derived from where each point sits relative to
 * the route's own two ends, so handing it several routes concatenated together
 * would trim only the outermost pair of ends and expose the rest.
 *
 * Both callers satisfy that: `route-data` maps one file's `trackPoints`, and
 * `generateFitnessRouteHeatmapJob` annotates per file inside its page loop,
 * before any cross-file accumulation. Its two preprocessing steps
 * (`downsampleRoutePoints`, `simplifyPoints`) both preserve endpoints, so the
 * anchors are still the real start and finish; measuring travel on the decimated
 * track under-estimates true route length, which trims slightly more than asked
 * rather than less.
 */
export const annotatePointsWithPrivacy = <T extends Coordinate>(
  points: T[],
  privacyLocation:
    FitnessPrivacyLocation | FitnessPrivacyLocation[] | null | undefined
): Array<T & { isHiddenByPrivacy: boolean }> => {
  const visibleRange = getPrivacyVisibleRange(points, privacyLocation)

  return points.map((point, index) => ({
    ...point,
    isHiddenByPrivacy:
      !visibleRange ||
      index < visibleRange.firstVisibleIndex ||
      index > visibleRange.lastVisibleIndex
  }))
}

// Splits wherever the flag flips. Fed `annotatePointsWithPrivacy` output it now
// sees at most two flips, so it yields at most `hidden head → visible run →
// hidden tail`. It stays general because the heatmap resume path rebuilds
// segments from cached flags, and because that bound is a property of the caller,
// not of this function.
export const buildPrivacySegments = <T extends { isHiddenByPrivacy: boolean }>(
  points: T[],
  options?: {
    includeHidden?: boolean
    includeVisible?: boolean
  }
): Array<PrivacySegment<T>> => {
  if (points.length === 0) {
    return []
  }

  const includeHidden = options?.includeHidden ?? true
  const includeVisible = options?.includeVisible ?? true
  const segments: Array<PrivacySegment<T>> = []

  let activeHiddenState = points[0].isHiddenByPrivacy
  let activeSegment: T[] = [points[0]]

  const pushSegment = (hiddenState: boolean, segmentPoints: T[]) => {
    if (segmentPoints.length === 0) {
      return
    }

    if (hiddenState && !includeHidden) {
      return
    }

    if (!hiddenState && !includeVisible) {
      return
    }

    segments.push({
      isHiddenByPrivacy: hiddenState,
      points: segmentPoints
    })
  }

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    if (point.isHiddenByPrivacy === activeHiddenState) {
      activeSegment.push(point)
      continue
    }

    pushSegment(activeHiddenState, activeSegment)
    activeHiddenState = point.isHiddenByPrivacy
    activeSegment = [point]
  }

  pushSegment(activeHiddenState, activeSegment)
  return segments
}

const downsamplePoints = <T>(points: T[], maxPoints: number): T[] => {
  if (maxPoints <= 0) {
    return []
  }

  if (points.length <= maxPoints) {
    return points
  }

  const sampled: T[] = []
  const step = (points.length - 1) / Math.max(1, maxPoints - 1)

  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(points[Math.round(index * step)])
  }

  return sampled
}

const allocateSegmentTargets = (
  segmentLengths: number[],
  maxPoints: number,
  minimumPointsPerSegment: number
): number[] => {
  const targets = segmentLengths.map(() => 0)

  if (maxPoints <= 0 || segmentLengths.length === 0) {
    return targets
  }

  const minimumPoints = Math.max(1, Math.floor(minimumPointsPerSegment))
  let remainingPoints = maxPoints

  const prioritizedIndices = segmentLengths
    .map((length, index) => ({ length, index }))
    .sort((first, second) => {
      if (second.length !== first.length) {
        return second.length - first.length
      }

      return first.index - second.index
    })
    .map((entry) => entry.index)

  for (const index of prioritizedIndices) {
    if (remainingPoints <= 0) {
      break
    }

    const length = segmentLengths[index]
    if (length <= 0) {
      continue
    }

    const minimumTarget = minimumPoints
    if (length < minimumTarget) {
      continue
    }

    if (remainingPoints < minimumTarget) {
      continue
    }

    targets[index] = minimumTarget
    remainingPoints -= minimumTarget
  }

  while (remainingPoints > 0) {
    let progressed = false

    for (const index of prioritizedIndices) {
      if (remainingPoints <= 0) {
        break
      }

      const length = segmentLengths[index]
      if (length <= 0 || targets[index] >= length) {
        continue
      }

      if (minimumPoints > 1 && targets[index] === 0) {
        continue
      }

      targets[index] += 1
      remainingPoints -= 1
      progressed = true
    }

    if (!progressed) {
      break
    }
  }

  return targets
}

export const downsamplePrivacySegments = <
  T extends { isHiddenByPrivacy: boolean }
>(
  segments: Array<PrivacySegment<T>>,
  maxPoints: number,
  options?: {
    minimumPointsPerSegment?: number
  }
): Array<PrivacySegment<T>> => {
  if (maxPoints <= 0 || segments.length === 0) {
    return []
  }

  const totalPoints = segments.reduce((sum, segment) => {
    return sum + segment.points.length
  }, 0)

  if (totalPoints <= maxPoints) {
    return segments
  }

  const minimumPointsPerSegment = options?.minimumPointsPerSegment ?? 1
  const targets = allocateSegmentTargets(
    segments.map((segment) => segment.points.length),
    maxPoints,
    minimumPointsPerSegment
  )

  return segments.flatMap((segment, index) => {
    const sampledPoints = downsamplePoints(segment.points, targets[index])
    if (sampledPoints.length === 0) {
      return []
    }

    return [
      {
        isHiddenByPrivacy: segment.isHiddenByPrivacy,
        points: sampledPoints
      }
    ]
  })
}

export const flattenPrivacySegments = <T>(
  segments: Array<PrivacySegment<T>>
): T[] => {
  return segments.flatMap((segment) => segment.points)
}

// Returns at most ONE segment now, by construction. Kept as `T[][]` because both
// map jobs hand the result straight to `generateMapImage`'s `routeSegments`, and
// a single-segment array is what makes it draw one `LineString` instead of a
// fragmented `MultiLineString`.
//
// `slice` returns the caller's own point objects, deliberately: the jobs deep-
// compare these against the parsed coordinates, so an added `isHiddenByPrivacy`
// key would be a visible difference. Do not re-route this through
// `annotatePointsWithPrivacy`.
export const getVisibleSegments = <T extends Coordinate>(
  points: T[],
  privacyLocation:
    FitnessPrivacyLocation | FitnessPrivacyLocation[] | null | undefined
): T[][] => {
  const visibleRange = getPrivacyVisibleRange(points, privacyLocation)
  if (!visibleRange) {
    return []
  }

  const visiblePoints = points.slice(
    visibleRange.firstVisibleIndex,
    visibleRange.lastVisibleIndex + 1
  )

  // Callers treat "fewer than two points" as "no route to draw", so a window
  // that survived down to a single point is no segment at all.
  return visiblePoints.length >= 2 ? [visiblePoints] : []
}
