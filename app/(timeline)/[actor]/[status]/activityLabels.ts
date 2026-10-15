import { Globe, Lock, type LucideIcon, Mail, Unlock } from 'lucide-react'

import { type MastodonVisibility } from '@/lib/utils/getVisibility'

export const VISIBILITY_META: Record<
  MastodonVisibility,
  { label: string; icon: LucideIcon }
> = {
  public: { label: 'Public', icon: Globe },
  unlisted: { label: 'Unlisted', icon: Unlock },
  private: { label: 'Followers only', icon: Lock },
  direct: { label: 'Direct', icon: Mail }
}

export const getActivityLabel = (activityType?: string) => {
  if (!activityType) return 'Activity'

  const normalized = activityType.toLowerCase()
  if (normalized.includes('ride') || normalized.includes('bike')) {
    return 'Ride'
  }
  if (normalized.includes('run')) return 'Run'
  if (normalized.includes('walk') || normalized.includes('hike')) return 'Walk'
  if (normalized.includes('swim')) return 'Swim'
  if (normalized.includes('row')) return 'Row'
  if (normalized.includes('yoga') || normalized.includes('pilates')) {
    return 'Yoga'
  }
  if (normalized.includes('climb')) return 'Climb'
  if (normalized.includes('ski') || normalized.includes('snowboard')) {
    return 'Ski'
  }
  if (normalized.includes('skat')) return 'Skate'
  if (normalized.includes('surf')) return 'Surf'
  if (normalized.includes('racket') || normalized.includes('tennis')) {
    return 'Racket'
  }
  if (normalized.includes('martial') || normalized.includes('box')) {
    return 'Martial Arts'
  }
  if (
    normalized.includes('team') ||
    normalized.includes('soccer') ||
    normalized.includes('football')
  ) {
    return 'Team Sports'
  }
  if (
    normalized.includes('train') ||
    normalized.includes('workout') ||
    normalized.includes('weight') ||
    normalized.includes('crossfit') ||
    normalized.includes('gym')
  ) {
    return 'Training'
  }
  if (normalized === 'other') return 'Other'

  return `${activityType[0].toUpperCase()}${activityType.slice(1)}`
}
