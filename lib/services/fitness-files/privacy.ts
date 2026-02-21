export const FITNESS_PRIVACY_RADIUS_OPTIONS = [0, 5, 10, 20, 50] as const

export type FitnessPrivacyRadiusMeters =
  (typeof FITNESS_PRIVACY_RADIUS_OPTIONS)[number]

interface Coordinate {
  lat: number
  lng: number
}

interface PrivacySettingsInput {
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number | null
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
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return FITNESS_PRIVACY_RADIUS_OPTIONS.includes(
    value as FitnessPrivacyRadiusMeters
  )
    ? (value as FitnessPrivacyRadiusMeters)
    : 0
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

export const getFitnessPrivacyLocation = (
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

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine))
}

export const isPointHiddenByPrivacy = (
  point: Coordinate,
  privacyLocation: FitnessPrivacyLocation | null
): boolean => {
  if (!privacyLocation) {
    return false
  }

  const distance = getDistanceMeters(point, privacyLocation)
  return distance <= privacyLocation.radiusMeters
}

export const annotatePointsWithPrivacy = <T extends Coordinate>(
  points: T[],
  privacyLocation: FitnessPrivacyLocation | null
): Array<T & { isHiddenByPrivacy: boolean }> => {
  return points.map((point) => ({
    ...point,
    isHiddenByPrivacy: isPointHiddenByPrivacy(point, privacyLocation)
  }))
}

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

export const downsamplePrivacySegments = <
  T extends { isHiddenByPrivacy: boolean }
>(
  segments: Array<PrivacySegment<T>>,
  maxPoints: number
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

  const minimumTargets = segments.map((segment) =>
    segment.points.length > 1 ? 2 : 1
  )

  const minimumTotal = minimumTargets.reduce((sum, value) => sum + value, 0)

  const targets = segments.map((segment) =>
    Math.min(
      segment.points.length,
      minimumTotal <= maxPoints ? (segment.points.length > 1 ? 2 : 1) : 1
    )
  )

  let allocated = targets.reduce((sum, value) => sum + value, 0)

  while (allocated < maxPoints) {
    let progressed = false

    for (let index = 0; index < segments.length; index += 1) {
      if (allocated >= maxPoints) {
        break
      }

      if (targets[index] >= segments[index].points.length) {
        continue
      }

      targets[index] += 1
      allocated += 1
      progressed = true
    }

    if (!progressed) {
      break
    }
  }

  return segments.map((segment, index) => ({
    isHiddenByPrivacy: segment.isHiddenByPrivacy,
    points: downsamplePoints(segment.points, targets[index])
  }))
}

export const flattenPrivacySegments = <T>(
  segments: Array<PrivacySegment<T>>
): T[] => {
  return segments.flatMap((segment) => segment.points)
}
