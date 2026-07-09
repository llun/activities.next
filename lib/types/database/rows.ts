import { type ActorType } from '@/lib/types/domain/actor'

// SQL row types - Types returned directly from database queries

export const POST_LINE_LIMIT_VALUES = [5, 10, 0] as const
export type PostLineLimit = (typeof POST_LINE_LIMIT_VALUES)[number]

export interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  manuallyApprovesFollowers?: boolean
  // Profile metadata fields (Mastodon update_credentials `fields_attributes`).
  // Stored as plain name/value pairs; URL verification is not performed.
  fields?: { name: string; value: string }[]
  // Mastodon `bot`/`discoverable` flags. `bot` marks an automated account;
  // `discoverable` opts into discovery features (profile directory). When unset
  // the builder falls back to a sensible default for the actor type.
  bot?: boolean
  discoverable?: boolean
  // Mastodon `source.*` posting defaults surfaced by the credential endpoints.
  defaultPrivacy?: 'public' | 'unlisted' | 'private' | 'direct'
  defaultSensitive?: boolean
  defaultLanguage?: string
  postLineLimit?: PostLineLimit
  // Mastodon `reading:*` preferences surfaced by /api/v1/preferences.
  readingExpandMedia?: 'default' | 'show_all' | 'hide_all'
  readingExpandSpoilers?: boolean
  readingAutoplayGifs?: boolean
  emailNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    activity_import?: boolean
    added_to_collection?: boolean
    collection_update?: boolean
  }
  pushNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    activity_import?: boolean
    added_to_collection?: boolean
    collection_update?: boolean
  }
  // Mastodon notification policy. Each value is 'accept' | 'filter' | 'drop'.
  // Structurally compatible with NotificationPolicy in database/operations.ts
  // (kept inline here to avoid an operations<->rows import cycle, matching the
  // emailNotifications/pushNotifications pattern).
  notificationPolicy?: {
    for_not_following?: 'accept' | 'filter' | 'drop'
    for_not_followers?: 'accept' | 'filter' | 'drop'
    for_new_accounts?: 'accept' | 'filter' | 'drop'
    for_private_mentions?: 'accept' | 'filter' | 'drop'
    for_limited_accounts?: 'accept' | 'filter' | 'drop'
  }
  // Per-sender accept list: senders in this list always have their notifications
  // accepted regardless of the notification policy dimensions.
  notificationAcceptedSenders?: string[]
}

export type ActorDeletionStatus = 'scheduled' | 'deleting' | null

export interface SQLActor {
  id: string
  type?: ActorType
  username: string
  domain: string
  name?: string
  summary?: string
  accountId: string | null

  publicKey: string
  privateKey: string

  settings: string | ActorSettings

  deletionStatus?: ActorDeletionStatus
  deletionScheduledAt?: number | Date | null

  // Greatest `createdAt` across all of the actor's `statuses` rows (including
  // Announce reblogs), or null when the actor has never posted. Maintained
  // inside the status create/delete transactions; backs the directory
  // `order=active` sort and the serializer's `last_status_at`.
  lastStatusAt?: number | Date | null

  createdAt: number | Date
  updatedAt: number | Date
}

export interface SQLAccount {
  id: string
  email: string
  name?: string | null
  iconUrl?: string | null
  passwordHash?: string | null
  verificationCode?: string | null
  passwordResetCode?: string | null
  passwordResetCodeExpiresAt?: number | Date | null
  emailChangePending?: string | null
  emailChangeCode?: string | null
  emailChangeCodeExpiresAt?: number | Date | null
  emailVerifiedAt?: number | Date | null
  twoFactorEnabled?: boolean | number | null
  role?: string | null

  createdAt: number | Date
  updatedAt: number | Date
  verifiedAt?: number | Date
}

export interface SQLDomainFederationRule {
  id: string
  domain: string
  type: string
  severity?: string | null
  rejectMedia: boolean | number
  rejectReports: boolean | number
  privateComment?: string | null
  publicComment?: string | null
  obfuscate: boolean | number
  source?: string | null
  createdAt: number | Date
  updatedAt: number | Date
}
