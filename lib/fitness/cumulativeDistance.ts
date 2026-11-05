/**
 * Cumulative distance along an activity's points. The activity page's
 * timeline (`buildActivityTimeline`) and the stored run best efforts
 * (`lib/services/fitness-files/bestEfforts.ts`) both read distance this way,
 * so a stored 5 km time is measured along the same distance the page charts.
 * Dependency-free: the browser and the server both import it.
 */

const EARTH_RADIUS_METERS = 6_371_000

const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const haversineMeters = (
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number => {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)))
}

export interface DistanceSample {
  elapsedSeconds: number
  distanceMeters?: number | null
  lat?: number
  lng?: number
  /** km/h */
  speed?: number
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const hasCoordinates = (
  sample: DistanceSample
): sample is DistanceSample & { lat: number; lng: number } =>
  isFiniteNumber(sample.lat) && isFiniteNumber(sample.lng)

/**
 * The distance at each of `sorted` (time-ordered) points: the file's own
 * cumulative distance where a point has it, otherwise measured along the GPS
 * track, or speed integrated over time when there is no track. Null when none
 * of that is possible for any point.
 */
export const cumulativeDistances = (
  sorted: ReadonlyArray<DistanceSample>
): number[] | null => {
  let distance = 0
  let hasDistance = false
  const distances = sorted.map((sample, index) => {
    const previous = index > 0 ? sorted[index - 1] : null
    if (isFiniteNumber(sample.distanceMeters)) {
      distance = sample.distanceMeters
      hasDistance = true
    } else if (previous) {
      if (hasCoordinates(sample) && hasCoordinates(previous)) {
        distance += haversineMeters(previous, sample)
        hasDistance = true
      } else if (isFiniteNumber(sample.speed)) {
        const seconds = Math.max(
          0,
          sample.elapsedSeconds - previous.elapsedSeconds
        )
        distance += (sample.speed / 3.6) * seconds
        hasDistance = true
      }
    }
    return distance
  })
  return hasDistance ? distances : null
}
