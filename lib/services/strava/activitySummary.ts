import { FitnessActivity } from '@/lib/types/domain/fitnessActivity'

/**
 * Activity type emoji mapping
 */
const ACTIVITY_EMOJI: Record<string, string> = {
  Run: '🏃',
  Ride: '🚴',
  Swim: '🏊',
  Walk: '🚶',
  Hike: '🥾',
  AlpineSki: '⛷️',
  BackcountrySki: '🎿',
  Canoeing: '🛶',
  Crossfit: '🏋️',
  EBikeRide: '🚴‍♂️',
  Elliptical: '🏃',
  Golf: '⛳',
  GravelRide: '🚴',
  Handcycle: '🚴',
  IceSkate: '⛸️',
  InlineSkate: '🛼',
  Kayaking: '🛶',
  Kitesurf: '🪁',
  NordicSki: '🎿',
  RockClimbing: '🧗',
  RollerSki: '🎿',
  Rowing: '🚣',
  Sail: '⛵',
  Skateboard: '🛹',
  Snowboard: '🏂',
  Snowshoe: '❄️',
  Soccer: '⚽',
  StairStepper: '🪜',
  StandUpPaddling: '🏄',
  Surfing: '🏄',
  Velomobile: '🚴',
  VirtualRide: '🚴',
  VirtualRun: '🏃',
  WeightTraining: '🏋️',
  Wheelchair: '♿',
  Windsurf: '🏄‍♂️',
  Workout: '💪',
  Yoga: '🧘'
}

/**
 * Format distance in meters to human-readable string
 */
function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }
  return `${Math.round(meters)} m`
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format pace (for running/walking activities)
 * Returns min/km
 */
function formatPace(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return '--:--'

  const secondsPerKm = 1000 / metersPerSecond
  const minutes = Math.floor(secondsPerKm / 60)
  const seconds = Math.round(secondsPerKm % 60)

  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`
}

/**
 * Format speed (for cycling activities)
 * Returns km/h
 */
function formatSpeed(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return '-- km/h'

  const kmh = metersPerSecond * 3.6
  return `${kmh.toFixed(1)} km/h`
}

/**
 * Format elevation gain
 */
function formatElevation(meters: number): string {
  return `${Math.round(meters)}m`
}

/**
 * Check if activity uses pace or speed for display
 */
function usesPace(activityType: string): boolean {
  const paceActivities = ['Run', 'Walk', 'Hike', 'VirtualRun']
  return paceActivities.includes(activityType)
}

/**
 * Generate a summary string for a fitness activity
 * Format:
 * 🏃 Morning Run
 * 📏 10.5 km in 52:30 (5:00/km)
 * ⬆️ 120m elevation
 * ❤️ 145 bpm avg
 */
export function formatActivitySummary(activity: FitnessActivity): string {
  const lines: string[] = []
  const emoji = ACTIVITY_EMOJI[activity.type] || '🏃'

  // Title line
  lines.push(`${emoji} ${activity.name}`)

  // Distance and time line
  if (activity.distance && activity.movingTime) {
    let speedStr = ''
    if (activity.averageSpeed) {
      speedStr = usesPace(activity.type)
        ? ` (${formatPace(activity.averageSpeed)})`
        : ` (${formatSpeed(activity.averageSpeed)})`
    }
    lines.push(
      `📏 ${formatDistance(activity.distance)} in ${formatDuration(activity.movingTime)}${speedStr}`
    )
  } else if (activity.distance) {
    lines.push(`📏 ${formatDistance(activity.distance)}`)
  } else if (activity.movingTime) {
    lines.push(`⏱️ ${formatDuration(activity.movingTime)}`)
  }

  // Elevation line
  if (activity.totalElevationGain && activity.totalElevationGain > 10) {
    lines.push(`⬆️ ${formatElevation(activity.totalElevationGain)} elevation`)
  }

  // Heart rate line
  if (activity.averageHeartrate) {
    lines.push(`❤️ ${Math.round(activity.averageHeartrate)} bpm avg`)
  }

  // Power line (for cycling)
  if (activity.averageWatts) {
    lines.push(`⚡ ${Math.round(activity.averageWatts)}W avg`)
  }

  return lines.join('\n')
}

/**
 * Generate a shorter summary suitable for federation
 * Used when character limits are a concern
 */
export function formatActivitySummaryShort(activity: FitnessActivity): string {
  const emoji = ACTIVITY_EMOJI[activity.type] || '🏃'
  const parts: string[] = []

  parts.push(`${emoji} ${activity.name}`)

  if (activity.distance) {
    parts.push(formatDistance(activity.distance))
  }

  if (activity.movingTime) {
    parts.push(formatDuration(activity.movingTime))
  }

  return parts.join(' • ')
}

/**
 * Generate hashtags for an activity
 */
export function getActivityHashtags(activity: FitnessActivity): string[] {
  const tags: string[] = ['fitness', 'strava']

  // Add activity type as hashtag
  tags.push(activity.type.toLowerCase())

  // Add sport type if different
  if (activity.sportType && activity.sportType !== activity.type) {
    tags.push(activity.sportType.toLowerCase().replace(/\s+/g, ''))
  }

  return tags.map((tag) => `#${tag}`)
}
