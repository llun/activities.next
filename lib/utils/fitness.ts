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
  activityType
}: {
  distanceMeters?: number
  durationSeconds?: number
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

  const normalizedType = activityType?.toLowerCase() ?? ''
  const usesPace =
    normalizedType.includes('run') ||
    normalizedType.includes('walk') ||
    normalizedType.includes('hike') ||
    normalizedType.includes('swim')

  if (usesPace) {
    const paceSeconds = Math.round(durationSeconds / distanceKm)
    const paceMinutes = Math.floor(paceSeconds / 60)
    const paceRemainderSeconds = paceSeconds % 60

    return {
      label: 'Pace',
      value: `${paceMinutes}:${paceRemainderSeconds
        .toString()
        .padStart(2, '0')} / km`
    }
  }

  const speedKmh = distanceKm / (durationSeconds / 3600)

  if (!Number.isFinite(speedKmh) || speedKmh <= 0) {
    return null
  }

  return {
    label: 'Avg speed',
    value: `${speedKmh.toFixed(1)} km/h`,
    speedKmh
  }
}
