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

export const getFitnessPrivacyLocation = (
  settings: PrivacySettingsInput | null | undefined
): FitnessPrivacyLocation | null => {
  // Legacy compatibility helper for code paths still expecting a single value.
  // New multi-location logic should use `getFitnessPrivacyLocations`.
  return getFitnessPrivacyLocations(settings)[0] ?? null
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

const normalizePrivacyLocations = (
  privacyLocation:
    | FitnessPrivacyLocation
    | FitnessPrivacyLocation[]
    | null
    | undefined
): FitnessPrivacyLocation[] => {
  if (!privacyLocation) {
    return []
  }

  return Array.isArray(privacyLocation) ? privacyLocation : [privacyLocation]
}

export const isPointHiddenByPrivacyLocations = (
  point: Coordinate,
  privacyLocations: FitnessPrivacyLocation[] | null | undefined
): boolean => {
  if (!privacyLocations || privacyLocations.length === 0) {
    return false
  }

  return privacyLocations.some((privacyLocation) => {
    return isPointHiddenByPrivacy(point, privacyLocation)
  })
}

export const annotatePointsWithPrivacy = <T extends Coordinate>(
  points: T[],
  privacyLocation:
    | FitnessPrivacyLocation
    | FitnessPrivacyLocation[]
    | null
    | undefined
): Array<T & { isHiddenByPrivacy: boolean }> => {
  const privacyLocations = normalizePrivacyLocations(privacyLocation)

  return points.map((point) => ({
    ...point,
    isHiddenByPrivacy: isPointHiddenByPrivacyLocations(point, privacyLocations)
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

export const getVisibleSegments = <T extends Coordinate>(
  points: T[],
  privacyLocation:
    | FitnessPrivacyLocation
    | FitnessPrivacyLocation[]
    | null
    | undefined
): T[][] => {
  const privacyLocations = normalizePrivacyLocations(privacyLocation)

  const privacyAwarePoints = points.map((point) => ({
    point,
    isHiddenByPrivacy: isPointHiddenByPrivacyLocations(point, privacyLocations)
  }))

  return buildPrivacySegments(privacyAwarePoints, {
    includeHidden: false,
    includeVisible: true
  })
    .map((segment) => segment.points.map((entry) => entry.point))
    .filter((segment) => segment.length >= 2)
}
