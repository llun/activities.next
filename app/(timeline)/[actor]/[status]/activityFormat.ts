const PACE_ACTIVITY_TYPES = new Set(['Run', 'Walk', 'Hike', 'VirtualRun'])

export const isPaceActivity = (type: string) => PACE_ACTIVITY_TYPES.has(type)

export const formatActivityDistance = (
  meters: number | null | undefined
): string => {
  if (!meters || meters <= 0) return '--'
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`
  return `${Math.round(meters)} m`
}

export const formatActivityDuration = (
  seconds: number | null | undefined
): string => {
  if (!seconds || seconds <= 0) return '--'

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
  }

  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
}

export const formatActivityPace = (
  metersPerSecond: number | null | undefined
): string => {
  if (!metersPerSecond || metersPerSecond <= 0) return '--'

  const secondsPerKm = 1000 / metersPerSecond
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)

  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`
}

export const formatActivitySpeed = (
  metersPerSecond: number | null | undefined
): string => {
  if (!metersPerSecond || metersPerSecond <= 0) return '--'
  return `${(metersPerSecond * 3.6).toFixed(1)} km/h`
}

export const formatActivityElevation = (
  meters: number | null | undefined
): string => {
  if (!meters || meters <= 0) return '--'
  return `${Math.round(meters)} m`
}

export const getEffortMetric = (
  activityType: string,
  averageSpeed: number | null | undefined
) => {
  if (isPaceActivity(activityType)) {
    return {
      label: 'Pace',
      value: formatActivityPace(averageSpeed)
    }
  }

  return {
    label: 'Avg speed',
    value: formatActivitySpeed(averageSpeed)
  }
}

export const formatActivityStartDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
