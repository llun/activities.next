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

/**
 * The ONE place a running/walking pace is turned into text: `m:ss /km` (the
 * design system's "5:09 /km" — no space after the slash). The activity page's
 * stat tile, the timeline chip and the activity-import email all reach it
 * through {@link getFitnessPaceOrSpeed}; do not hand-format a pace beside it.
 *
 * Rounds the TOTAL seconds before splitting, so 5:59.5 reads "6:00 /km" rather
 * than "5:60 /km". A missing, non-finite or zero pace has no honest rendering,
 * so it yields `options.fallback` (default `null`) and the caller drops the
 * stat. The app is kilometre-only — there is no imperial setting to branch on.
 */
export const formatFitnessPace = (
  secondsPerKm?: number,
  options?: FormatMetricOptions
): string | null => {
  if (typeof secondsPerKm !== 'number' || !Number.isFinite(secondsPerKm)) {
    return options?.fallback ?? null
  }

  const totalSeconds = Math.round(secondsPerKm)
  if (totalSeconds <= 0) {
    return options?.fallback ?? null
  }

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`
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
    const pace = formatFitnessPace(effectiveDurationSeconds / distanceKm)
    if (!pace) return null

    return { label: 'Pace', value: pace }
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

export const sortStatusFitnessFiles = <
  T extends {
    activityStartTime?: number | null
    fileName: string
    id: string
  }
>(
  files: T[]
): T[] => {
  return [...files].sort((first, second) => {
    const firstStart = first.activityStartTime ?? Number.MAX_SAFE_INTEGER
    const secondStart = second.activityStartTime ?? Number.MAX_SAFE_INTEGER

    if (firstStart !== secondStart) {
      return firstStart - secondStart
    }

    if (first.fileName !== second.fileName) {
      return first.fileName.localeCompare(second.fileName)
    }

    return first.id.localeCompare(second.id)
  })
}
