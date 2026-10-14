import type { NavItemId } from '@/lib/services/navigation/navPreferences'
import type { PostLineLimit } from '@/lib/types/database/rows'
import type { ActorProfile } from '@/lib/types/domain/actor'
import type { Status } from '@/lib/types/domain/status'
import type { TimelineParentPreview } from '@/lib/types/domain/timeline'

export const MAX_CACHED_STATUSES_PER_TIMELINE = 200
export const MAX_CACHED_ACTORS = 3
export const OFFLINE_DB_NAME = 'activities_offline_v1'
export const OFFLINE_DB_VERSION = 1

export interface BootstrapInstanceLimits {
  maxStatusCharacters: number
  maxMediaFileSize: number
  maxMediaAttachments: number
  maxPollOptions: number
  maxPollOptionCharacters: number
  minPollExpirationSeconds: number
  maxPollExpirationSeconds: number
}

export interface BootstrapUserSummary {
  name: string
  username: string
  handle: string
  avatarUrl?: string | null
}

export interface BootstrapActorSummary {
  id: string
  username: string
  domain: string
  name?: string
  iconUrl?: string | null
  deletionStatus?: 'scheduled' | 'deleting' | null
  deletionScheduledAt?: number | null
}

export interface BootstrapListSummary {
  id: string
  title: string
}

export interface BootstrapFeatures {
  fitness: boolean
  pushNotifications: boolean
  strava: boolean
  events: boolean
  travel: boolean
  photoEditorAi: boolean
}

export interface ClientBootstrapSnapshot {
  accountId: string
  actorId: string
  host: string
  currentTime: number
  user: BootstrapUserSummary
  currentActor: BootstrapActorSummary
  actors: BootstrapActorSummary[]
  profile: ActorProfile
  unreadCount: number
  fitnessUrl?: string
  galleryUrl?: string
  isAdmin: boolean
  isMediaUploadEnabled: boolean
  lists: BootstrapListSummary[]
  features: Partial<BootstrapFeatures>
  instanceLimits: BootstrapInstanceLimits
  navOrder?: NavItemId[]
  navHidden?: NavItemId[]
  readingAutoplayGifs: boolean
  postLineLimit?: PostLineLimit
  readingGroupBoosts: boolean
  savedAt: number
}

export interface ActiveOfflineSessionMeta {
  key: 'activeSession'
  accountId: string
  actorId: string
  updatedAt: number
}

export interface SetActiveOfflineSessionParams {
  actorId: string
  accountId?: string
  updatedAt?: number
}

export interface ScrollAnchorState {
  statusId: string
  offsetTop: number
  updatedAt: number
}

export interface PersistedTimelineSegment {
  statusIds: string[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

export interface PersistedTimelineState {
  actorId: string
  timeline: string
  filterKey: string
  segments: PersistedTimelineSegment[]
  ancestorsById: Record<string, TimelineParentPreview>
  lastRefreshedAt: number
  scrollAnchor: ScrollAnchorState | null
}

export interface HydratedTimelineSegment {
  statuses: Status[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

export interface HydratedOfflineTimeline {
  actorId: string
  timeline: string
  filterKey: string
  segments: HydratedTimelineSegment[]
  statuses: Status[]
  ancestorsById: Record<string, TimelineParentPreview>
  nextMaxStatusId: string | null
  lastRefreshedAt: number
  scrollAnchor: ScrollAnchorState | null
}

export interface PersistedStatusRecord {
  actorId: string
  statusId: string
  status: Status
  updatedAt: number
}
