export interface PaceOrSpeed {
  label: 'Pace' | 'Avg speed'
  value: string
  speedKmh?: number
}

interface FormatMetricOptions {
  fallback?: string | null
}

export const formatFitnessDistance = (
  distanceMeters?: number,
  options?: FormatMetricOptions
): string | null => {
  if (typeof distanceMeters !== 'number' || distanceMeters <= 0) {
    return options?.fallback ?? null
  }

  const distanceKm = distanceMeters / 1000

  if (distanceKm >= 10) {
    return `${distanceKm.toFixed(1)} km`
  }

  return `${distanceKm.toFixed(2)} km`
}

export const formatFitnessDuration = (
  durationSeconds?: number,
  options?: FormatMetricOptions
): string | null => {
  if (typeof durationSeconds !== 'number' || durationSeconds <= 0) {
    return options?.fallback ?? null
  }

  const totalSeconds = Math.max(0, Math.round(durationSeconds))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export const formatFitnessElevation = (
  elevationGainMeters?: number,
  options?: FormatMetricOptions
): string | null => {
  if (typeof elevationGainMeters !== 'number' || elevationGainMeters <= 0) {
    return options?.fallback ?? null
  }

  return `${Math.round(elevationGainMeters)} m`
}

export const getFitnessPaceOrSpeed = ({
  distanceMeters,
  durationSeconds,
  movingTimeSeconds,
  activityType
}: {
  distanceMeters?: number
  durationSeconds?: number
  movingTimeSeconds?: number
  activityType?: string
}): PaceOrSpeed | null => {
  if (
    typeof distanceMeters !== 'number' ||
    typeof durationSeconds !== 'number' ||
    distanceMeters <= 0 ||
    durationSeconds <= 0
  ) {
    return null
  }

  const distanceKm = distanceMeters / 1000
  if (distanceKm <= 0) return null

  // Average pace/speed is measured over MOVING time, not elapsed time — this is
  // what Strava reports. A ride that spans 1:16:54 (elapsed) but only moves for
  // 1:13:09 has its stops excluded, so distance/moving > distance/elapsed. Fall
  // back to the full elapsed duration when moving time is unavailable (older
  // records not yet reprocessed, or files with no per-point data to derive it).
  const effectiveDurationSeconds =
    typeof movingTimeSeconds === 'number' && movingTimeSeconds > 0
      ? movingTimeSeconds
      : durationSeconds

  const normalizedType = activityType?.toLowerCase() ?? ''
  const usesPace =
    normalizedType.includes('run') ||
    normalizedType.includes('walk') ||
    normalizedType.includes('hike') ||
    normalizedType.includes('swim')

  if (usesPace) {
    const paceSeconds = Math.round(effectiveDurationSeconds / distanceKm)
    const paceMinutes = Math.floor(paceSeconds / 60)
    const paceRemainderSeconds = paceSeconds % 60

    return {
      label: 'Pace',
      value: `${paceMinutes}:${paceRemainderSeconds
        .toString()
        .padStart(2, '0')} / km`
    }
  }

  const speedKmh = distanceKm / (effectiveDurationSeconds / 3600)

  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    return null
  }

  return {
    label: 'Avg speed',
    value: `${speedKmh.toFixed(1)} km/h`,
    speedKmh
  }
}

// Defense-in-depth: only treat an http(s) URL as a renderable fitness source
// link. Today `sourceUrl` is always server-derived (getStravaActivityUrl yields
// a hardcoded https Strava URL or null), but the column is generic and rendered
// as an href, so we never surface a non-http scheme (e.g. javascript:) even if
// a future writer forwards a less-trusted value.
export const normalizeFitnessSourceUrl = (
  sourceUrl?: string | null
): string | null => {
  if (!sourceUrl) return null
  try {
    const { protocol } = new URL(sourceUrl)
    if (protocol === 'http:' || protocol === 'https:') {
      return sourceUrl
    }
    return null
  } catch {
    return null
  }
}

// Derive a human-friendly label for an external fitness "source" link from its
// host. Strava-hosted URLs read as "View on Strava"; anything else falls back to
// a generic label so the column can hold links from future providers too.
export const getFitnessSourceLabel = (sourceUrl?: string | null): string => {
  if (!sourceUrl) return 'View source'
  try {
    const { hostname } = new URL(sourceUrl)
    const normalizedHost = hostname.toLowerCase().replace(/^www\./, '')
    if (
      normalizedHost === 'strava.com' ||
      normalizedHost.endsWith('.strava.com')
    ) {
      return 'View on Strava'
    }
    return 'View source'
  } catch {
    return 'View source'
  }
}
