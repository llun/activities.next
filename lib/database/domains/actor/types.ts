// Parameter and result types of the actor domain (actor rows, their profile
// settings, counters, deletion state and the Mastodon Account view).
// lib/types/database/operations.ts re-exports them, so existing imports keep
// working.
import type {
  NotificationPolicy,
  UpdateNotificationPolicyParams
} from '@/lib/types/database/operations'
import type {
  ActorSettings,
  ActorSettingsField,
  PostLineLimit
} from '@/lib/types/database/rows'
import type { Actor, ActorType } from '@/lib/types/domain/actor'
import type * as Mastodon from '@/lib/types/mastodon'

export type CreateActorParams = {
  actorId: string
  type?: ActorType

  username: string
  domain: string
  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  manuallyApprovesFollowers?: boolean
  // Mastodon profile metadata fields. A field keeps the verification of a
  // stored field that has the same value (see carryOverFieldVerification), a
  // changed value starts unverified, and any `verifiedAt` passed in is ignored.
  fields?: ActorSettingsField[]
  tags?: { type: 'emoji'; name: string; value: string }[]
  // Remote actors: where they moved to, and their claimed aliases.
  movedTo?: string | null
  alsoKnownAs?: string[]

  inboxUrl: string
  sharedInboxUrl: string
  followersUrl: string

  publicKey: string
  privateKey?: string

  createdAt: number
}
export type GetActorFromEmailParams = { email: string }
export type GetActorFromUsernameParams = { username: string; domain: string }
export type GetActorFromIdParams = { id: string }
export type GetActorsFromIdsParams = { ids: string[] }
export interface GetActorIdByPublicIdParams {
  publicId: string
}
export interface GetActorIdsByPublicIdsParams {
  publicIds: string[]
}
export interface GetActorPublicIdsParams {
  actorIds: string[]
}
export type GetLocalActorsParams = {
  localDomain: string
  limit?: number
  offset?: number
  order?: 'active' | 'new'
  // false lists every known profile (Mastodon's default directory); true
  // keeps only this server's account-backed actors. Defaults to true at the
  // database layer to preserve the method's historical behavior.
  local?: boolean
}
export type SetActorCountersParams = {
  actorId: string
  // null/undefined preserves the locally-accumulated value for that counter
  // (e.g. remotes that hide a collection's totalItems). Every call stamps the
  // remote-counts-synced marker row regardless, which is what
  // hasActorCounters reports — counter-row existence can't carry the sync
  // signal because local accumulation (follows, federated statuses) also
  // creates those rows.
  followersCount?: number | null
  followingCount?: number | null
  statusCount?: number | null
}
export type HasActorCountersParams = { actorId: string }
export type IsCurrentActorFollowingParams = {
  currentActorId: string
  followingActorId: string
}
export type MarkActorProfileFieldsVerifiedParams = {
  actorId: string
  // The field values the rel="me" check passed for.
  values: string[]
  verifiedAt: number
  // When the check ran; stored as `linksCheckedAt` even if `values` is empty.
  checkedAt: number
}
export type ClaimActorMoveParams = {
  actorId: string
  // The inbound Move activity (job message id) claiming the actor.
  activityId: string
  // The account it moves to; the claim is bound to it.
  target: string
  now: number
  // How long a claim blocks other Moves of the same actor.
  windowMs: number
}
export type ClearActorMoveParams = { actorId: string; activityId: string }
export type MarkActorMoveVerifiedParams = {
  actorId: string
  activityId: string
}
export type MarkActorMoveQueuedParams = {
  actorId: string
  activityId: string
}
export type UpdateActorParams = {
  actorId: string
  type?: ActorType

  name?: string
  summary?: string
  iconUrl?: string | null
  headerImageUrl?: string | null
  manuallyApprovesFollowers?: boolean
  // Mastodon profile metadata fields. A field keeps the verification of a
  // stored field that has the same value (see carryOverFieldVerification), a
  // changed value starts unverified, and any `verifiedAt` passed in is ignored.
  fields?: ActorSettingsField[]
  tags?: { type: 'emoji'; name: string; value: string }[]
  // Mastodon `bot`/`discoverable` flags and `source.*` posting defaults.
  bot?: boolean
  discoverable?: boolean
  indexable?: boolean
  hideCollections?: boolean
  attributionDomains?: string[]
  // Remote actors: `null` clears a recorded move, `[]` clears the aliases.
  movedTo?: string | null
  alsoKnownAs?: string[]
  defaultPrivacy?: 'public' | 'unlisted' | 'private' | 'direct'
  defaultSensitive?: boolean
  defaultLanguage?: string
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
    emoji_reaction?: boolean
    activity_import?: boolean
    gear_service_due?: boolean
  }
  fitness?: {
    strava?: {
      clientId: string
      clientSecret: string
    }
  }
  notificationPolicy?: NotificationPolicy
  notificationAcceptedSenders?: string[]
  // Atomically appends IDs to notificationAcceptedSenders inside updateActor's
  // transaction, avoiding the read-modify-write race of separate read + write.
  appendNotificationAcceptedSenders?: string[]
  // Mastodon 4.6 Profile-entity appearance settings (PATCH /api/v1/profile):
  // avatar/header alt texts, the profile Media/Featured tab visibility flags,
  // and the domains allowed to credit this account in link previews.
  avatarDescription?: string
  headerDescription?: string
  showMedia?: boolean
  showMediaReplies?: boolean
  showFeatured?: boolean
  // Profile tab visibility (absent means shown); see ActorSettings.
  showReplies?: boolean
  showGallery?: boolean
  showFitness?: boolean
  // Navigation customization (see ActorSettings). Callers send the whole list
  // each time; an empty array resets that half to the shipped defaults.
  navOrder?: string[]
  navHidden?: string[]

  publicKey?: string

  followersUrl?: string
  inboxUrl?: string
  sharedInboxUrl?: string
}

export interface UpdateActorAliasesParams {
  actorId: string
  add?: string
  remove?: string
  max: number
}

export type UpdateActorAliasesResult =
  | { status: 'ok'; aliases: string[] }
  | { status: 'duplicate' }
  | { status: 'limit' }
  | { status: 'not-found' }
  | { status: 'no-actor' }

export type ScheduleActorDeletionParams = {
  actorId: string
  scheduledAt: Date | null // null means immediate deletion
}
export type DeleteActorParams = {
  actorId: string
}
export type GetActorDeletionStatusParams = {
  actorId: string
}

export type GetActorFollowingCountParams = { actorId: string }
export type GetActorFollowersCountParams = { actorId: string }
export type GetActorSettingsParams = { actorId: string }
export type CancelActorDeletionParams = { actorId: string }
export type GetActorsScheduledForDeletionParams = { beforeDate: Date }
export type StartActorDeletionParams = { actorId: string }
export type DeleteActorDataParams = { actorId: string }

export interface ActorDatabase {
  createActor(params: CreateActorParams): Promise<Actor | null>
  getActorFromId(params: GetActorFromIdParams): Promise<Actor | null>
  getActorsFromIds(params: GetActorsFromIdsParams): Promise<Actor[]>
  getActorIdByPublicId(
    params: GetActorIdByPublicIdParams
  ): Promise<string | null>
  // publicId -> actor URI, for the batch id resolver. One query per request
  // instead of one per id.
  getActorIdsByPublicIds(
    params: GetActorIdsByPublicIdsParams
  ): Promise<Map<string, string>>
  getActorPublicIds(
    params: GetActorPublicIdsParams
  ): Promise<Map<string, string>>
  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | null>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | null>
  getFederationSigningActor(): Promise<Actor | null>
  getMastodonActorFromId(
    params: GetActorFromIdParams
  ): Promise<Mastodon.Account | null>
  getMastodonActorsFromIds(
    params: GetActorsFromIdsParams
  ): Promise<Mastodon.Account[]>
  getLocalMastodonActors(
    params: GetLocalActorsParams
  ): Promise<Mastodon.Account[]>
  updateActor(params: UpdateActorParams): Promise<Actor | null>
  // updateActor, also returning the actor as read under the write's row lock
  // (`before`; null when the actor does not exist) next to the saved one
  // (`after`). Decide federation from these two, not from a pre-read.
  updateActorWithPrevious(
    params: UpdateActorParams
  ): Promise<{ before: Actor | null; after: Actor | null }>
  updateActorAliases(
    params: UpdateActorAliasesParams
  ): Promise<UpdateActorAliasesResult>
  // Atomically claims the actor for one inbound Move (Mastodon's nx key):
  // false when a different activity claimed it within `windowMs`.
  claimActorMove(params: ClaimActorMoveParams): Promise<boolean>
  // Releases the claim, only when `activityId` still holds it and it is not
  // verified.
  clearActorMove(params: ClearActorMoveParams): Promise<void>
  // Marks the claim of `activityId` as verified: it can no longer be released.
  markActorMoveVerified(params: MarkActorMoveVerifiedParams): Promise<void>
  markActorMoveQueued(params: MarkActorMoveQueuedParams): Promise<void>
  markActorProfileFieldsVerified(
    params: MarkActorProfileFieldsVerifiedParams
  ): Promise<void>
  deleteActor(params: DeleteActorParams): Promise<void>
  setActorCounters(params: SetActorCountersParams): Promise<void>
  hasActorCounters(params: HasActorCountersParams): Promise<boolean>
  isCurrentActorFollowing(
    params: IsCurrentActorFollowingParams
  ): Promise<boolean>
  scheduleActorDeletion(params: ScheduleActorDeletionParams): Promise<void>
  cancelActorDeletion(params: CancelActorDeletionParams): Promise<void>
  startActorDeletion(params: StartActorDeletionParams): Promise<void>
  getActorsScheduledForDeletion(
    params: GetActorsScheduledForDeletionParams
  ): Promise<Actor[]>
  deleteActorData(params: DeleteActorDataParams): Promise<void>
  getActorDeletionStatus(
    params: GetActorFromIdParams
  ): Promise<{ status: string | null; scheduledAt: number | null } | undefined>
  getActorFollowingCount(params: GetActorFollowingCountParams): Promise<number>
  getActorFollowersCount(params: GetActorFollowersCountParams): Promise<number>
  getActorSettings(
    params: GetActorSettingsParams
  ): Promise<ActorSettings | undefined>
  // Notification policy is persisted on actor settings. getNotificationPolicy
  // always resolves a full policy (Mastodon defaults applied for missing keys).
  getNotificationPolicy(
    params: GetActorSettingsParams
  ): Promise<NotificationPolicy>
  updateNotificationPolicy(
    params: UpdateNotificationPolicyParams
  ): Promise<NotificationPolicy>
  getNodeInfoStats(): Promise<{
    totalUsers: number
    activeMonth: number
    activeHalfyear: number
    localPosts: number
  }>
}

// The facade's actor methods: the ActorDatabase interface plus the Mastodon
// Account lookups, which actorQueries binds too. Production code calls the
// lookups through lib/database/domains/actor/mastodon.ts; only the actor
// query tests read them off the facade, through this type.
export interface SQLActorDatabase extends ActorDatabase {
  getMastodonActor: (actorId: string) => Promise<Mastodon.Account | null>
  getMastodonActors: (actorIds: string[]) => Promise<Mastodon.Account[]>
}
