import { type ActorType } from '@/lib/types/domain/actor'

// SQL row types - Types returned directly from database queries

export const POST_LINE_LIMIT_VALUES = [5, 10, 0] as const
export type PostLineLimit = (typeof POST_LINE_LIMIT_VALUES)[number]

export interface ActorSettingsField {
  name: string
  value: string
  verifiedAt?: number | null
}

export interface ActorSettings {
  iconUrl?: string
  headerImageUrl?: string
  followersUrl: string
  inboxUrl: string
  sharedInboxUrl: string
  manuallyApprovesFollowers?: boolean
  // Profile metadata fields (Mastodon update_credentials `fields_attributes`).
  // Stored as name/value pairs; `verifiedAt` (epoch ms) is set by
  // VerifyProfileLinksJob once the value's page links back with rel="me", and
  // is dropped whenever the value changes. It is never federated.
  fields?: ActorSettingsField[]
  // When (epoch ms) VerifyProfileLinksJob last ran for this actor, whatever the
  // outcome. Bounds how often a remote profile render re-queues the check.
  // Internal: never federated and never in the API.
  linksCheckedAt?: number
  // Remote actors only: the inbound `Move` this server is processing (or has
  // processed) for the actor, and when it claimed it (epoch ms). It is
  // Mastodon's `move_in_progress:<account_id>` key (set with nx for 7 days,
  // cleared when verification fails). `activityId` is the job message id, so a
  // retry of the same activity can tell itself from a second Move.
  // Internal: never federated and never in the API.
  // `verified` is set once the target was verified and `movedTo` recorded: a
  // verified claim is never released, so a later replay that fails cannot free
  // the 7-day window. `queued` is set once every follower job was published, so
  // a replay of the same Move after that does nothing (Mastodon's
  // `move_in_progress`).
  moveProcessing?: {
    at: number
    activityId: string
    target: string
    verified?: boolean
    queued?: boolean
  }
  // Custom emoji tags in display name/bio.
  tags?: { type: 'emoji'; name: string; value: string }[]
  // Mastodon `bot`/`discoverable` flags. `bot` marks an automated account;
  // `discoverable` opts into discovery features (profile directory). When unset
  // the builder falls back to a sensible default for the actor type.
  bot?: boolean
  discoverable?: boolean
  // Mastodon 4.x account flags stored alongside bot/discoverable. `indexable`
  // opts the account's public posts into full-text search by anyone (Mastodon
  // defaults this to false / opt-in); `hideCollections` hides the follower and
  // following collections on the profile; `attributionDomains` lists domains
  // allowed to credit this account (update_credentials
  // `attribution_domains[]`).
  indexable?: boolean
  hideCollections?: boolean
  attributionDomains?: string[]
  // Remote actors only: the account they migrated to (`movedTo`) and the
  // accounts they claim as aliases (`alsoKnownAs`), as last seen in their
  // actor document. Nothing sets them on a local actor yet.
  movedTo?: string
  alsoKnownAs?: string[]
  // Mastodon `source.*` posting defaults surfaced by the credential endpoints.
  defaultPrivacy?: 'public' | 'unlisted' | 'private' | 'direct'
  defaultSensitive?: boolean
  defaultLanguage?: string
  // Default `quote_approval_policy` for new statuses (Mastodon 4.5
  // `posting:default:quote_policy` / `source[quote_policy]`).
  defaultQuotePolicy?: 'public' | 'followers' | 'nobody'
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
    quote?: boolean
    quoted_update?: boolean
    emoji_reaction?: boolean
    activity_import?: boolean
    gear_service_due?: boolean
  }
  pushNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
    quote?: boolean
    quoted_update?: boolean
    emoji_reaction?: boolean
    activity_import?: boolean
    gear_service_due?: boolean
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
  // Mastodon 4.6 Profile-entity appearance settings (PATCH /api/v1/profile):
  // avatar/header alt texts, the profile Media/Featured tab visibility flags,
  // and the domains allowed to credit this account in link previews.
  avatarDescription?: string
  headerDescription?: string
  showMedia?: boolean
  showMediaReplies?: boolean
  showFeatured?: boolean
  // Profile tab visibility, presentation only (never federated, never a
  // privacy control): an absent key means the tab is shown. The Media tab is
  // `showMedia` above, as in Mastodon. Posts is always shown.
  showReplies?: boolean
  showGallery?: boolean
  showFitness?: boolean
  // Navigation customization. Both hold `NavItemId`s from
  // lib/services/navigation/navPreferences (kept as plain strings here so this
  // module stays import-free, matching the inline shapes above): `navOrder` is
  // the user's sidebar order and `navHidden` the items tucked under "More".
  // Empty or absent means the shipped defaults; ids this release no longer
  // knows are ignored on read.
  navOrder?: string[]
  navHidden?: string[]
}

export type ActorDeletionStatus = 'scheduled' | 'deleting' | null

export interface SQLActor {
  id: string
  publicId?: string | null
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

  // Moderation state (Admin moderation API). Nullable timestamps: NULL means
  // untouched. These live on `actors` (not `accounts`) because suspend/silence/
  // sensitize apply to remote actors too, which have no account row.
  suspendedAt?: number | Date | null
  silencedAt?: number | Date | null
  sensitizedAt?: number | Date | null

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
  // better-auth's verification flag: 0/1 on SQLite, a real boolean on
  // PostgreSQL.
  emailVerified?: boolean | number | null
  twoFactorEnabled?: boolean | number | null
  role?: string | null

  // Moderation/registration state (Admin moderation API). `disabledAt` freezes
  // login-wide; `approvedAt` gates sign-in (backfilled to createdAt for every
  // existing account, set at creation while no approval-required mode exists).
  disabledAt?: number | Date | null
  approvedAt?: number | Date | null
  // The normalised domain the account signed up on; null on accounts created
  // before the column, which all signed up on the primary.
  signUpDomain?: string | null

  createdAt: number | Date
  updatedAt: number | Date
  // Nullable: `createAccount` writes an explicit null while the registration's
  // confirmation e-mail is outstanding. The column's `DEFAULT CURRENT_TIMESTAMP`
  // means rows written before that always carry a value, which is exactly why
  // the default cannot be relied on to mean "confirmed".
  verifiedAt?: number | Date | null
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
