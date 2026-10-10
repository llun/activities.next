import { z } from 'zod'

import type { CreateQueueJobParams } from '@/lib/database/domains/queueJob/types'
import { Timeline } from '@/lib/services/timelines/types'
import {
  IucnCategory,
  MediaDetailsRecord,
  MediaLookupOwnedDetail,
  MediaLookupStatus,
  MediaSubjectCategory,
  MediaSubjectSuggestions
} from '@/lib/types/database/gallery'
import {
  ActorSettings,
  PostLineLimit,
  SQLAccount,
  SQLActor
} from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor, ActorType } from '@/lib/types/domain/actor'
import {
  Attachment,
  AttachmentMediaMetadata,
  PostBoxAttachment
} from '@/lib/types/domain/attachment'
import {
  Collection,
  CollectionFeatureState,
  CollectionVisibility
} from '@/lib/types/domain/collection'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { List, ListRepliesPolicy } from '@/lib/types/domain/list'
import { Session } from '@/lib/types/domain/session'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import * as Mastodon from '@/lib/types/mastodon'

// ============================================================================
// Base Database
// ============================================================================

export interface BaseDatabase {
  migrate(): Promise<void>
  destroy(): Promise<void>
}

// ============================================================================
// Actor Database
// ============================================================================

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
  // Mastodon profile metadata fields (name/value pairs).
  fields?: { name: string; value: string }[]
  tags?: { type: 'emoji'; name: string; value: string }[]

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
export type UpdateActorParams = {
  actorId: string
  type?: ActorType

  name?: string
  summary?: string
  iconUrl?: string | null
  headerImageUrl?: string | null
  manuallyApprovesFollowers?: boolean
  // Mastodon profile metadata fields (name/value pairs).
  fields?: { name: string; value: string }[]
  tags?: { type: 'emoji'; name: string; value: string }[]
  // Mastodon `bot`/`discoverable` flags and `source.*` posting defaults.
  bot?: boolean
  discoverable?: boolean
  indexable?: boolean
  hideCollections?: boolean
  attributionDomains?: string[]
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
    emoji_reaction?: boolean
    activity_import?: boolean
    gear_service_due?: boolean
    added_to_collection?: boolean
    collection_update?: boolean
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
  // Navigation customization (see ActorSettings). Callers send the whole list
  // each time; an empty array resets that half to the shipped defaults.
  navOrder?: string[]
  navHidden?: string[]

  publicKey?: string

  followersUrl?: string
  inboxUrl?: string
  sharedInboxUrl?: string
}
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

// ============================================================================
// Account Database
// ============================================================================

export type IsAccountExistsParams = { email: string }
export type IsUsernameExistsParams = { username: string; domain: string }
export type CreateAccountParams = {
  email: string
  username: string
  name?: string | null
  passwordHash: string
  verificationCode?: string | null
  domain: string
  privateKey: string
  publicKey: string
}
export type GetAccountFromIdParams = { id: string }
export type GetAccountFromEmailParams = { email: string }
export type LinkAccountWithProviderParams = {
  accountId: string
  provider: string
  providerAccountId: string
}
export type VerifyAccountParams = {
  verificationCode: string
}
export type CreateAccountSessionParams = {
  accountId: string
  token: string
  expireAt: number
  actorId?: string | null
}
export type GetAccountAllSessionsParams = {
  accountId: string
}
export type DeleteAccountSessionByIdParams = {
  // Only a session this account owns is deleted; anything else matches nothing.
  accountId: string
  id: string
}
export type DeleteOtherAccountSessionsParams = {
  accountId: string
  // The session to keep (the device making the request). Every other session
  // for the account is revoked.
  exceptToken: string
}

export type UnlinkAccountFromProviderParams = {
  accountId: string
  provider: string
}

export type CreateActorForAccountParams = {
  accountId: string
  username: string
  domain: string
  privateKey: string
  publicKey: string
}
export type GetActorsForAccountParams = { accountId: string }
export type SetDefaultActorParams = { accountId: string; actorId: string }

export type RequestEmailChangeParams = {
  accountId: string
  newEmail: string
  emailChangeCode: string
}
export type VerifyEmailChangeParams = {
  accountId?: string
  emailChangeCode: string
}
export type RequestPasswordResetParams = {
  email: string
  passwordResetCode: string | null
  expiresAt?: number | null
  // When set, the code is written only if the account has no live code issued
  // within this many milliseconds; otherwise nothing is written and the call
  // returns false. The check is a predicate on the UPDATE, so concurrent
  // requests cannot each slip past it.
  cooldownMs?: number
}
export type ValidatePasswordResetCodeParams = {
  passwordResetCode: string
}
export type ResetPasswordWithCodeParams = {
  accountId?: string
  passwordResetCode: string
  newPasswordHash: string
}
export type ChangePasswordParams = {
  accountId: string
  newPasswordHash: string
}
export type RepointUnconfirmedAccountEmailParams = {
  accountId: string
  email: string
  // A freshly minted code for the NEW address.
  //
  // This method is for one job — moving an account that is still awaiting
  // confirmation onto a different address — and it is named for that job
  // because the write is only correct there. It replaces every proof the
  // account had about its OLD address: the code, `emailVerified`, `verifiedAt`
  // and `emailVerifiedAt` all move together, because each of them proves
  // control of the address it was set for and none may outlive it.
  //
  // The UPDATE is predicated on the account still being pending
  // (`verificationCode` non-empty and not marked `emailVerified`), so an
  // account confirmed concurrently is not re-pointed. The re-read account is
  // returned so the caller can distinguish "no such account" (null) from
  // "no longer pending" (isAccountConfirmationPending false).
  //
  // So do NOT reach for this to change a CONFIRMED account's address. It would
  // strip that account's verification and leave it unable to sign in
  // (`requireEmailVerification` reads `emailVerified`) and unable to resend
  // (`POST /api/v1/emails/confirmations` requires an outstanding code) — an
  // unrecoverable state that nothing flags, because
  // `isAccountConfirmationPending` reads a code that is no longer set. The
  // confirmed-user flow is `requestEmailChange`/`verifyEmailChange`, which
  // proves the new address before moving anything.
  verificationCode: string
}
export type UpdateAccountNameParams = {
  accountId: string
  name: string | null
}
export type UpdateAccountImageParams = {
  accountId: string
  iconUrl: string | null
}

export interface AccountDatabase {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | null>
  getAccountFromEmail(
    params: GetAccountFromEmailParams
  ): Promise<Account | null>
  verifyAccount(params: VerifyAccountParams): Promise<Account | null>

  createAccountSession(params: CreateAccountSessionParams): Promise<void>
  getAccountAllSessions(params: GetAccountAllSessionsParams): Promise<Session[]>
  // Deletes the session with this row id when it belongs to `accountId`, and
  // returns how many rows were deleted (0 for an unknown or foreign id).
  deleteAccountSessionById(
    params: DeleteAccountSessionByIdParams
  ): Promise<number>
  // Revoke every session for the account except `exceptToken`. Returns the
  // number of sessions revoked.
  deleteOtherAccountSessions(
    params: DeleteOtherAccountSessionsParams
  ): Promise<number>

  unlinkAccountFromProvider(
    params: UnlinkAccountFromProviderParams
  ): Promise<void>

  createActorForAccount(params: CreateActorForAccountParams): Promise<string>
  getActorsForAccount(params: GetActorsForAccountParams): Promise<Actor[]>
  setDefaultActor(params: SetDefaultActorParams): Promise<void>

  requestEmailChange(params: RequestEmailChangeParams): Promise<void>
  verifyEmailChange(params: VerifyEmailChangeParams): Promise<Account | null>
  requestPasswordReset(params: RequestPasswordResetParams): Promise<boolean>
  validatePasswordResetCode(
    params: ValidatePasswordResetCodeParams
  ): Promise<string | null>
  resetPasswordWithCode(
    params: ResetPasswordWithCodeParams
  ): Promise<Account | null>
  changePassword(params: ChangePasswordParams): Promise<void>
  repointUnconfirmedAccountEmail(
    params: RepointUnconfirmedAccountEmailParams
  ): Promise<Account | null>
  updateAccountName(params: UpdateAccountNameParams): Promise<void>
  updateAccountImage(params: UpdateAccountImageParams): Promise<void>
}

// ============================================================================
// Status Database
// ============================================================================

interface BaseCreateStatusParams {
  id: string
  actorId: string
  to: string[]
  cc: string[]

  url: string
  text: string
  summary?: string | null
  reply?: string

  // Mastodon-compatible content flags persisted in the status content blob.
  sensitive?: boolean
  language?: string | null

  // Who may quote this status (FEP-044f / Mastodon 4.5). Persisted in the status
  // content blob, not a column. Omit to leave it unset (defaults to `public` at
  // consumption).
  quoteApprovalPolicy?: QuoteApprovalPolicy

  // The registered OAuth client (Mastodon "application") that authored the
  // status. Null when created through the web session.
  applicationName?: string | null
  applicationWebsite?: string | null

  createdAt?: number
  // The client-facing UUIDv7 id. Omit to mint one from createdAt (or now).
  // Callers that already generated the id for the status URI tail (Task 1.5)
  // pass it here so the URI tail, web-url tail, and stored publicId agree.
  publicId?: string
}

export type CreateNoteParams = BaseCreateStatusParams

type BaseStatusParams = {
  statusId: string
}

/**
 * An attachment resolved for an edit: the client's media reference plus the
 * `medias` snapshot the attachment row carries (see `AttachmentMediaMetadata`).
 *
 * The three snapshot fields are REQUIRED, not optional, so a caller cannot
 * quietly hand `updateNote` a bare `PostBoxAttachment` and blank the
 * placeholder and focal point of every attachment it rewrites — the edit path
 * has to resolve them from the owner's own media rows first.
 */
export type UpdateNoteAttachment = PostBoxAttachment & AttachmentMediaMetadata

export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> &
  BaseStatusParams & {
    attachments?: UpdateNoteAttachment[]
    // Omit to preserve the existing value; provide to overwrite.
    sensitive?: boolean
    language?: string | null
  }

export type UpdateStatusQuoteApprovalPolicyParams = BaseStatusParams & {
  quoteApprovalPolicy: QuoteApprovalPolicy
}

export type UpdateNoteVisibilityParams = BaseStatusParams & {
  to: string[]
  cc: string[]
}

export type CreateAnnounceParams = Pick<
  BaseCreateStatusParams,
  'id' | 'actorId' | 'to' | 'cc' | 'createdAt' | 'publicId'
> & {
  originalStatusId: string
}

export type CreatePollParams = BaseCreateStatusParams & {
  choices: (string | { title: string; totalVotes?: number })[]
  endAt: number
  pollType?: 'oneOf' | 'anyOf'
  // Mastodon poll[hide_totals]: hide per-option tallies until the poll expires.
  hideTotals?: boolean
}

/**
 * Discriminated result of a status create that recovers from a concurrent
 * duplicate insert. `isNew` is false when a racing delivery of the same object
 * won the unique key and this call returned the winner's existing row — the
 * signal `createNoteJob` / `createPollJob` read to skip re-running their
 * (non-idempotent) tag / attachment / hashtag side effects. The plain
 * `createNote` / `createPoll` methods keep returning just the `Status`; only
 * the `*WithResult` variants surface `isNew`.
 */
export type CreateStatusResult = {
  status: Status
  isNew: boolean
}
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> &
  BaseStatusParams & {
    choices: { title: string; totalVotes: number }[]
    // Omit to preserve the existing values; provide to overwrite (user edits).
    sensitive?: boolean
    language?: string | null
    endAt?: number
    pollType?: 'oneOf' | 'anyOf'
    hideTotals?: boolean
    // When true `choices` replaces the option set and all recorded votes are
    // cleared (Mastodon edit semantics); when false/omitted `choices` only
    // refreshes tallies for the existing titles (federated poll refresh).
    resetVotes?: boolean
  }

export type GetStatusParams = BaseStatusParams & {
  currentActorId?: string
  withReplies?: boolean
}
export type GetStatusRepliesParams = BaseStatusParams & {
  url?: string
  limit?: number
  publicOnly?: boolean
  visibleToActorId?: string | null
  // Hydration-only viewer; see GetActorStatusesParams.
  currentActorId?: string
  order?: 'asc' | 'desc'
}
export type GetStatusEditHistoryParams = BaseStatusParams
// A single superseded revision of a status (a row in `status_history`). `text`
// and `summary` are the content of that prior version; `supersededAt` is when it
// was replaced by the next version, which is the creation time of that next
// version.
export type StatusEditRevision = {
  // The row's creation timestamp has historically been the status creation
  // time; `supersededAt` is the transition timestamp recorded by `updatedAt`.
  createdAt: number
  text: string
  summary: string | null
  // Per-revision snapshots. Null on rows written before snapshotting existed;
  // readers fall back to the status's current values for those.
  sensitive: boolean | null
  attachments: Attachment[] | null
  pollOptions: string[] | null
  // Distinguishes an explicitly empty value from a legacy or malformed row
  // that did not snapshot that field.
  available: {
    text: boolean
    summary: boolean
    sensitive: boolean
    attachments: boolean
    pollOptions: boolean
  }
  supersededAt: number
}
export type DeleteStatusParams = BaseStatusParams & {
  actorId?: string
}

export type DeleteStatusWithQueueJobParams = {
  actorId: string
  statusId: string
  queueJob: CreateQueueJobParams
}

export type GetStatusFromUrlParams = {
  url: string
  // The signed-in viewer, so the resolved status carries their own like,
  // bookmark and reaction state. A status's `url` is its web permalink, which
  // is never equal to its `id`, so this lookup — not the id lookup beside it —
  // is what a pasted link actually resolves through.
  currentActorId?: string
}
export type GetStatusFromUrlHashParams = {
  urlHash: string
  actorId?: string
  // The signed-in viewer, so the returned status carries their own like,
  // bookmark and reaction state — the hash route lands on the same status
  // detail page as the id route and must hydrate it the same way.
  currentActorId?: string
}

export interface GetStatusIdByPublicIdParams {
  publicId: string
}
export interface GetStatusIdsByPublicIdsParams {
  publicIds: string[]
}
export interface GetStatusFromPublicIdParams {
  publicId: string
  currentActorId?: string
}
export interface GetStatusPublicIdsParams {
  statusIds: string[]
}
export interface GetActorStatusFromPathSegmentParams {
  actorId: string
  // The `[statusId]` segment of `/users/:username/statuses/:statusId`. It is
  // either the tail of the status URI or the status publicId — a status created
  // before publicIds existed keeps its original tail and only gained a publicId
  // in the backfill, so both forms address the same row.
  pathSegment: string
  withReplies?: boolean
}

export type GetActorAnnouncedStatusIdParams = {
  actorId: string
  originalStatusId: string
}

export type GetActorStatusesCountParams = {
  actorId: string
  publicOnly?: boolean
}
export type GetActorStatusesParams = {
  actorId: string
  // The signed-in viewer, for hydration only: it decides the like, bookmark and
  // reaction state carried on the returned statuses. `visibleToActorId` below is
  // the separate *visibility filter* and must not be conflated with it — a
  // viewer id passed there changes which statuses come back.
  currentActorId?: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
  onlyMedia?: boolean
  excludeReplies?: boolean
  excludeReblogs?: boolean
  tagged?: string | null
  pinned?: boolean
}
export type PinStatusParams = {
  actorId: string
  statusId: string
  maxPinnedStatuses?: number
}
export type GetPinnedStatusIdsParams = {
  actorId: string
  statusIds?: string[]
}
export type GetStatusesByIdsParams = {
  statusIds: string[]
  currentActorId?: string
  visibleToActorId?: string | null
  withReplies?: boolean
}

export type HasActorAnnouncedStatusParams = BaseStatusParams & {
  actorId?: string
}
export type GetFavouritedByParams = BaseStatusParams & {
  limit: number
  // Opaque base64url cursors (see favouritedByCursor). `maxId` pages toward
  // older favourites, `minId`/`sinceId` toward newer ones.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type FavouritedByAccount = {
  actorId: string
  createdAt: number
}
export type GetRebloggedByParams = BaseStatusParams & {
  limit?: number
  maxStatusId?: string
  minStatusId?: string
  sinceStatusId?: string
  visibleToActorId?: string | null
}
export type RebloggedByAccount = {
  actorId: string
  statusId: string
}

export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
  /**
   * For multi-hashtag insert flows only. Callers that set this for hashtag tags
   * must call indexHashtagSearchDocuments once after all skipped tags are
   * inserted.
   */
  skipSearchIndex?: boolean
}
export type GetTagsParams = {
  statusId: string
}
export type DeleteStatusTagsByTypeParams = {
  statusId: string
  type: TagType
}
export type GetStatusesByHashtagParams = {
  hashtag: string
  // The signed-in viewer. Hydration only — it decides the like/bookmark/reaction
  // state on the returned statuses and never which statuses are returned (a tag
  // timeline is public by definition).
  currentActorId?: string
  limit?: number
  minStatusId?: string
  maxStatusId?: string
  // Attachments-only filter (Mastodon `only_media`).
  onlyMedia?: boolean
  // Author-locality scope (Mastodon `local`/`remote`): local means the author
  // has an actors row with a privateKey (this server hosts it).
  local?: boolean
  remote?: boolean
  // Mastodon tag-timeline modes: `anyTags` widen the primary match, `allTags`
  // must all be present, `noneTags` must all be absent. Bare names, no `#`.
  anyTags?: string[]
  allTags?: string[]
  noneTags?: string[]
}
export type GetHashtagStatusesPageParams = {
  hashtag: string
  limit: number
  offset: number
}
export type GetHashtagStatusesPageResult = {
  statuses: Status[]
  total: number
}
export type GetHashtagCounterParams = {
  hashtag: string
}
export type IncreaseHashtagCounterParams = {
  hashtag: string
}
export type DecreaseHashtagCounterParams = {
  hashtag: string
}
export type GetStatusReblogsCountParams = {
  statusId: string
}
export type GetStatusCountsParams = {
  statusIds: string[]
}
export type GetStatusRepliesCountParams = {
  statusId: string
  url?: string
  publicOnly?: boolean
}

export type CreatePollAnswerParams = {
  statusId: string
  actorId: string
  choice: number
}
export type HasActorVotedParams = {
  statusId: string
  actorId: string
}
export type GetActorPollVotesParams = {
  statusId: string
  actorId: string
}
export type GetActorPollVotesForStatusesParams = {
  statusIds: string[]
  actorId: string
}
export type IncrementPollChoiceVotesParams = {
  statusId: string
  choiceIndex: number
}
export type RecordPollVotesParams = {
  statusId: string
  actorId: string
  choices: number[]
  allowAdditionalChoices?: boolean
}

export interface StatusDatabase {
  createNote(params: CreateNoteParams): Promise<Status>
  // Same insert as createNote, but reports whether the row was newly created
  // (isNew) or recovered from a concurrent duplicate. See CreateStatusResult.
  createNoteWithResult(params: CreateNoteParams): Promise<CreateStatusResult>
  createAnnounce(params: CreateAnnounceParams): Promise<Status | null>
  createPoll(params: CreatePollParams): Promise<Status>
  // Same insert as createPoll, but reports whether the row was newly created.
  createPollWithResult(params: CreatePollParams): Promise<CreateStatusResult>
  updateNote(params: UpdateNoteParams): Promise<Status | null>
  // Rewrites the status's quote-approval policy in the content blob without
  // recording an edit (no status_history append, no edited_at bump).
  updateStatusQuoteApprovalPolicy(
    params: UpdateStatusQuoteApprovalPolicyParams
  ): Promise<Status | null>
  updateNoteVisibility(
    params: UpdateNoteVisibilityParams
  ): Promise<Status | null>
  updatePoll(params: UpdatePollParams): Promise<Status | null>
  getStatus(params: GetStatusParams): Promise<Status | null>
  getStatusReplies(params: GetStatusRepliesParams): Promise<Status[]>
  getStatusEditHistory(
    params: GetStatusEditHistoryParams
  ): Promise<StatusEditRevision[]>
  // Drops every prior revision of a status. Used when its audience widens:
  // `status_history` does not record who a revision was written for.
  deleteStatusEditHistory(params: GetStatusEditHistoryParams): Promise<void>
  getStatusFromUrl(params: GetStatusFromUrlParams): Promise<Status | null>
  getStatusFromUrlHash(
    params: GetStatusFromUrlHashParams
  ): Promise<Status | null>
  getStatusIdByPublicId(
    params: GetStatusIdByPublicIdParams
  ): Promise<string | null>
  // publicId -> status URI, for the batch id resolver. One query per request
  // instead of one per id.
  getStatusIdsByPublicIds(
    params: GetStatusIdsByPublicIdsParams
  ): Promise<Map<string, string>>
  getStatusFromPublicId(
    params: GetStatusFromPublicIdParams
  ): Promise<Status | null>
  getStatusPublicIds(
    params: GetStatusPublicIdsParams
  ): Promise<Map<string, string>>
  // Resolves the `[statusId]` path segment of the ActivityPub status routes,
  // accepting either the status URI tail or the status publicId. Scoped to
  // `actorId`: a publicId belonging to another actor resolves to null instead
  // of surfacing under this actor's URL space.
  getActorStatusFromPathSegment(
    params: GetActorStatusFromPathSegmentParams
  ): Promise<Status | null>
  getActorAnnouncedStatusId(
    params: GetActorAnnouncedStatusIdParams
  ): Promise<string | null>
  getActorAnnounceStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<Status | null>
  deleteStatus(params: DeleteStatusParams): Promise<void>
  deleteStatusWithQueueJob(
    params: DeleteStatusWithQueueJobParams
  ): Promise<boolean>
  getActorStatusesCount(params: GetActorStatusesCountParams): Promise<number>
  getActorStatuses(params: GetActorStatusesParams): Promise<Status[]>
  pinStatus(params: PinStatusParams): Promise<boolean>
  unpinStatus(params: PinStatusParams): Promise<void>
  getPinnedStatusIds(params: GetPinnedStatusIdsParams): Promise<string[]>
  getStatusesByIds(params: GetStatusesByIdsParams): Promise<Status[]>
  getFavouritedBy(params: GetFavouritedByParams): Promise<FavouritedByAccount[]>
  getRebloggedBy(params: GetRebloggedByParams): Promise<RebloggedByAccount[]>
  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>
  deleteStatusTagsByType(params: DeleteStatusTagsByTypeParams): Promise<void>
  getStatusesByHashtag(params: GetStatusesByHashtagParams): Promise<Status[]>
  getHashtagStatusesPage(
    params: GetHashtagStatusesPageParams
  ): Promise<GetHashtagStatusesPageResult>
  getHashtagCounter(params: GetHashtagCounterParams): Promise<number>
  increaseHashtagCounter(params: IncreaseHashtagCounterParams): Promise<void>
  decreaseHashtagCounter(params: DecreaseHashtagCounterParams): Promise<void>
  getStatusReblogsCount(params: GetStatusReblogsCountParams): Promise<number>
  getStatusReblogsCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>>
  getStatusRepliesCount(params: GetStatusRepliesCountParams): Promise<number>
  getStatusRepliesCounts(
    params: GetStatusCountsParams
  ): Promise<Record<string, number>>
  createPollAnswer(params: CreatePollAnswerParams): Promise<void>
  hasActorVoted(params: HasActorVotedParams): Promise<boolean>
  getActorPollVotes(params: GetActorPollVotesParams): Promise<number[]>
  getActorPollVotesForStatuses(
    params: GetActorPollVotesForStatusesParams
  ): Promise<Record<string, number[]>>
  incrementPollChoiceVotes(
    params: IncrementPollChoiceVotesParams
  ): Promise<void>
  recordPollVotes(params: RecordPollVotesParams): Promise<boolean>
}

// ============================================================================
// Status Detected Language Database
// ============================================================================

export type {
  ClearDetectedLanguageParams,
  GetDetectedLanguageParams,
  GetDetectedLanguagesParams,
  SetDetectedLanguageParams,
  StatusDetectedLanguageDatabase
} from '@/lib/database/domains/statusDetectedLanguage/types'

// ============================================================================
// Search Database
// ============================================================================

export const SearchDocumentEntityType = z.enum(['account', 'status', 'hashtag'])
export type SearchDocumentEntityType = z.infer<typeof SearchDocumentEntityType>

export type SearchDocument = {
  id: string
  entityType: SearchDocumentEntityType
  entityId: string
  documentText: string
  actorId: string | null
  visibility: string | null
  entityCreatedAt: number | null
  discoverable: boolean | null
  postCount: number | null
  lastPostAt: number | null
  createdAt: number
  updatedAt: number
}

export type UpsertSearchDocumentParams = {
  entityType: SearchDocumentEntityType
  entityId: string
  documentText: string
  actorId?: string | null
  visibility?: string | null
  entityCreatedAt?: number | null
  discoverable?: boolean | null
  postCount?: number | null
  lastPostAt?: number | null
}

export type DeleteSearchDocumentParams = {
  entityType: SearchDocumentEntityType
  entityId: string
}

export type SearchDocumentsParams = {
  entityType?: SearchDocumentEntityType
  q: string
  limit: number
  offset?: number
  includeNonDiscoverable?: boolean
  visibleToActorId?: string | null
}

export type SearchAccountsParams = {
  q: string
  limit: number
  offset?: number
  localDomain?: string | null
  followingActorId?: string | null
  exactActorIds?: string[]
}

export type SearchHashtagsParams = {
  q: string
  limit: number
  offset?: number
  excludeUnreviewed?: boolean
}

export type SearchHashtag = {
  name: string
  url: string
  history: { day: string; uses: string; accounts: string }[]
  following?: boolean
  postCount: number
  lastPostAt: number | null
}

export type SearchStatusesParams = {
  q: string
  limit: number
  offset?: number
  currentActorId: string
  currentActorUsername?: string | null
  currentActorDomain?: string | null
  accountId?: string | null
  minId?: string | null
  maxId?: string | null
}

export type ReindexSearchDocumentsParams = {
  afterId?: string | null
  limit?: number
}

export type ReindexSearchDocumentsResult = {
  indexed: number
  nextCursor: string | null
}

export interface SearchDatabase {
  upsertSearchDocument(params: UpsertSearchDocumentParams): Promise<void>
  deleteSearchDocument(params: DeleteSearchDocumentParams): Promise<void>
  searchDocuments(params: SearchDocumentsParams): Promise<SearchDocument[]>
  searchAccountIds(params: SearchAccountsParams): Promise<string[]>
  indexActorSearchDocument(params: GetActorFromIdParams): Promise<void>
  deleteActorSearchDocument(params: GetActorFromIdParams): Promise<void>
  reindexSearchAccounts(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
  searchHashtags(params: SearchHashtagsParams): Promise<SearchHashtag[]>
  indexHashtagSearchDocument(params: { hashtag: string }): Promise<void>
  indexHashtagSearchDocuments(params: { hashtags: string[] }): Promise<void>
  deleteHashtagSearchDocument(params: { hashtag: string }): Promise<void>
  reindexSearchHashtags(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
  searchStatusIds(params: SearchStatusesParams): Promise<string[]>
  indexStatusSearchDocument(params: BaseStatusParams): Promise<void>
  deleteStatusSearchDocument(params: BaseStatusParams): Promise<void>
  reindexSearchStatuses(
    params?: ReindexSearchDocumentsParams
  ): Promise<ReindexSearchDocumentsResult>
}

// ============================================================================
// Direct Conversation Database
// ============================================================================

export type DirectConversation = {
  id: string
  actorId: string
  conversationId: string
  rootStatusId: string
  participantActorIds: string[]
  lastStatusId: string
  lastStatus: Status
  lastStatusCreatedAt: number
  unread: boolean
  readAt: number | null
  hiddenAt: number | null
  createdAt: number
  updatedAt: number
}

export type SyncDirectConversationForStatusParams = {
  status: Status
  excludedLocalActorIds?: string[]
}

export type GetDirectConversationsParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
}

export type GetDirectConversationParams = {
  actorId: string
  conversationId: string
  includeHidden?: boolean
}

export type MarkDirectConversationReadParams = {
  actorId: string
  conversationId: string
}

export type HideDirectConversationParams = {
  actorId: string
  conversationId: string
}

export type GetDirectConversationStatusesParams = {
  actorId: string
  conversationId: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}

export interface DirectConversationDatabase {
  syncDirectConversationForStatus(
    params: SyncDirectConversationForStatusParams
  ): Promise<void>
  getDirectConversations(
    params: GetDirectConversationsParams
  ): Promise<DirectConversation[]>
  getDirectConversation(
    params: GetDirectConversationParams
  ): Promise<DirectConversation | null>
  markDirectConversationRead(
    params: MarkDirectConversationReadParams
  ): Promise<DirectConversation | null>
  hideDirectConversation(params: HideDirectConversationParams): Promise<void>
  getDirectConversationStatuses(
    params: GetDirectConversationStatusesParams
  ): Promise<Status[]>
}

// ============================================================================
// Follow Database
// ============================================================================

export type CreateFollowParams = {
  actorId: string
  targetActorId: string
  status: FollowStatus
  inbox: string
  sharedInbox: string
  // Optional local follow preferences (Mastodon follow params). Default when
  // omitted: reblogs=true, notify=false, languages=null (no language filter).
  reblogs?: boolean
  notify?: boolean
  languages?: string[] | null
}
export type UpdateFollowPreferencesParams = {
  actorId: string
  targetActorId: string
  // Only the fields actually provided are updated; omitted fields are left as-is.
  reblogs?: boolean
  notify?: boolean
  languages?: string[] | null
}
export type GetLocalFollowersForActorIdParams = { targetActorId: string }
export type GetLocalActorsFromFollowerUrlParams = { followerUrl: string }
export type GetLocalFollowsFromInboxUrlParams = {
  targetActorId: string
  followerInboxUrl: string
}
export type GetFollowFromIdParams = { followId: string }
export type GetAcceptedOrRequestedFollowParams = {
  actorId: string
  targetActorId: string
}
export type GetAcceptedFollowTargetActorIdsParams = {
  actorId: string
  targetActorIds: string[]
}
export type GetFollowersInboxParams = { targetActorId: string }
export type UpdateFollowStatusParams = {
  followId: string
  status: FollowStatus
}
// New type for getting follows with pagination
export type GetFollowingParams = {
  actorId: string
  limit: number
  maxId?: string | null
  // min_id and since_id are ordered differently: min_id returns the oldest band
  // immediately after the cursor, since_id the newest band above it.
  minId?: string | null
  sinceId?: string | null
}
export type GetFollowersParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetAcceptedOrRequestedFollowsWithDomainParams = {
  actorId: string
  domain: string
  limit: number
}
export type GetFollowRequestsParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetFollowRequestsCountParams = {
  targetActorId: string
}

export interface FollowDatabase {
  createFollow(params: CreateFollowParams): Promise<Follow>
  updateFollowPreferences(
    params: UpdateFollowPreferencesParams
  ): Promise<Follow | null>
  getFollowFromId(params: GetFollowFromIdParams): Promise<Follow | null>
  getLocalFollowersForActorId(
    params: GetLocalFollowersForActorIdParams
  ): Promise<Follow[]>
  getLocalFollowsFromInboxUrl(
    params: GetLocalFollowsFromInboxUrlParams
  ): Promise<Follow[]>
  getLocalActorsFromFollowerUrl(
    params: GetLocalActorsFromFollowerUrlParams
  ): Promise<Actor[]>
  getAcceptedOrRequestedFollow(
    params: GetAcceptedOrRequestedFollowParams
  ): Promise<Follow | null>
  getAcceptedOrRequestedFollowsWithDomain(
    params: GetAcceptedOrRequestedFollowsWithDomainParams
  ): Promise<Follow[]>
  getAcceptedFollowTargetActorIds(
    params: GetAcceptedFollowTargetActorIdsParams
  ): Promise<string[]>
  getFollowersInbox(params: GetFollowersInboxParams): Promise<string[]>
  updateFollowStatus(params: UpdateFollowStatusParams): Promise<void>
  // New method for getting following with pagination
  getFollowing(params: GetFollowingParams): Promise<Follow[]>
  getFollowers(params: GetFollowersParams): Promise<Follow[]>
  // Follow requests methods
  getFollowRequests(params: GetFollowRequestsParams): Promise<Follow[]>
  getFollowRequestsCount(params: GetFollowRequestsCountParams): Promise<number>
}

// ============================================================================
// Block Database
// ============================================================================

export type {
  BlockDatabase,
  BlockRelation,
  CreateBlockParams,
  DeleteBlockByUriParams,
  DeleteBlockParams,
  GetBlockByUriParams,
  GetBlockParams,
  GetBlockRelationsParams,
  GetBlocksParams,
  IsBlockingParams,
  IsEitherBlockingParams
} from '@/lib/database/domains/block/types'

// ============================================================================
// Actor Domain Block Database (user-level Mastodon domain blocks)
// ============================================================================

export type {
  ActorDomainBlockDatabase,
  CreateActorDomainBlockParams,
  DeleteActorDomainBlockParams,
  GetActorDomainBlocksParams,
  IsDomainBlockedByActorParams
} from '@/lib/database/domains/actorDomainBlock/types'

// ============================================================================
// Mute Database
// ============================================================================

export type {
  CreateMuteParams,
  DeleteMuteParams,
  GetMuteParams,
  GetMuteRelationsParams,
  GetMutesParams,
  MuteDatabase,
  MuteRelation
} from '@/lib/database/domains/mute/types'

export type {
  GetMarkersParams,
  MarkerDatabase,
  MarkerRow,
  MarkerTimeline,
  UpsertMarkerParams
} from '@/lib/database/domains/marker/types'

// ============================================================================
// Status (conversation) Mute Database
// ============================================================================

export type {
  CreateStatusMuteParams,
  DeleteStatusMuteParams,
  GetActorMutedConversationRootIdsParams,
  IsConversationMutedParams,
  StatusMuteDatabase
} from '@/lib/database/domains/statusMute/types'

// ============================================================================
// Idempotency Key Database
// ============================================================================

export type {
  GetIdempotentStatusIdParams,
  IdempotencyDatabase,
  SaveIdempotencyKeyParams
} from '@/lib/database/domains/idempotency/types'

// ============================================================================
// Translation Cache Database
// ============================================================================

export type {
  GetTranslationCacheParams,
  SaveTranslationCacheParams,
  TranslationCacheDatabase,
  TranslationCacheEntry
} from '@/lib/database/domains/translationCache/types'

// ============================================================================
// List Database
// ============================================================================

export type CreateListParams = {
  actorId: string
  title: string
  repliesPolicy?: ListRepliesPolicy
  exclusive?: boolean
}
export type UpdateListParams = {
  id: string
  actorId: string
  title?: string
  repliesPolicy?: ListRepliesPolicy
  exclusive?: boolean
}
export type GetListParams = { id: string; actorId: string }
export type GetListsParams = { actorId: string }
export type DeleteListParams = { id: string; actorId: string }
export type GetListAccountsParams = {
  listId: string
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type ListAccountsPage = {
  accounts: Mastodon.Account[]
  // Membership-row id of the oldest/newest row on this page, used to build the
  // Mastodon max_id/min_id pagination cursors. Null when the page is empty.
  nextMaxId: string | null
  prevMinId: string | null
}
export type AddListAccountsParams = {
  listId: string
  actorId: string
  targetActorIds: string[]
  // Admit only the owner and accounts the owner follows or has asked to
  // follow, checked in the same transaction as the insert (see
  // addListAccounts). Without it the members are inserted unconditionally.
  requireFollowOrRequest?: boolean
}
export type AddListAccountsResult = {
  // Accounts refused by requireFollowOrRequest: neither followed nor requested.
  // When any are refused, nothing is added.
  unrelatedActorIds: string[]
}
export type RemoveListAccountsParams = {
  listId: string
  actorId: string
  targetActorIds: string[]
}
export type GetListsWithAccountParams = {
  actorId: string
  targetActorId: string
}
export type GetListAccountCountsParams = {
  actorId: string
  listIds: string[]
}
export type GetListTimelineParams = {
  listId: string
  actorId: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
  sinceStatusId?: string | null
}
export type AddStatusToListTimelinesParams = {
  status: Status
}

export interface ListDatabase {
  createList(params: CreateListParams): Promise<List>
  updateList(params: UpdateListParams): Promise<List | null>
  getList(params: GetListParams): Promise<List | null>
  getLists(params: GetListsParams): Promise<List[]>
  deleteList(params: DeleteListParams): Promise<boolean>
  getListAccounts(params: GetListAccountsParams): Promise<ListAccountsPage>
  // Member counts keyed by list id for the supplied lists. Lists with no
  // members are present in the result with a count of 0.
  getListAccountCounts(
    params: GetListAccountCountsParams
  ): Promise<Record<string, number>>
  addListAccounts(params: AddListAccountsParams): Promise<AddListAccountsResult>
  removeListAccounts(params: RemoveListAccountsParams): Promise<void>
  getListsWithAccount(params: GetListsWithAccountParams): Promise<List[]>
  getListTimeline(params: GetListTimelineParams): Promise<Status[]>
  // Fan a newly created status into every list (in the `timelines` table) whose
  // membership includes the status author, except one whose owner is still
  // waiting on a follow request to them. Called from addStatusToTimelines.
  addStatusToListTimelines(
    params: AddStatusToListTimelinesParams
  ): Promise<void>
}

export type CreateCollectionParams = {
  actorId: string
  title: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionVisibility
  sensitive?: boolean
  publicFeed?: boolean
}
export type UpdateCollectionParams = {
  id: string
  actorId: string
  title?: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionVisibility
  sensitive?: boolean
  publicFeed?: boolean
}
export type GetCollectionParams = { id: string; actorId: string }
// Resolve a collection by id WITHOUT owner-scoping. Used by surfaces where the
// viewer is not the owner: the public collection page (which applies its own
// visibility/feed gate) and member-facing collection notifications (the member
// is legitimately in the collection, so may see its title). Callers are
// responsible for any visibility gating.
export type GetCollectionByIdParams = { id: string }
export type GetCollectionsParams = { actorId: string }
export type DeleteCollectionParams = { id: string; actorId: string }

export type AddCollectionMembersParams = {
  id: string
  actorId: string
  targetActorIds: string[]
}
export type RemoveCollectionMembersParams = {
  id: string
  actorId: string
  targetActorIds: string[]
}
// Member-facing consent action: the member (actorId) sets the state of THEIR
// OWN membership in a collection, regardless of who owns it. Used by the
// approve / revoke endpoints. Returns false when no such membership exists.
export type SetOwnCollectionMembershipStateParams = {
  collectionId: string
  actorId: string
  state: CollectionFeatureState
}
export type GetCollectionMembersParams = {
  id: string
  actorId: string
  // 'owner' returns all members; 'public' returns only approved members.
  projection?: 'owner' | 'public'
  limit?: number
  maxId?: string | null
  sinceId?: string | null
}
export type CollectionMembersPage = {
  accounts: Mastodon.Account[]
  nextMaxId: string | null
  prevMinId: string | null
}
export type GetCollectionMemberCountsParams = {
  actorId: string
  collectionIds: string[]
  // Count only approved members (the public size) when true; otherwise all.
  approvedOnly?: boolean
}
export type GetCollectionTimelineParams = {
  id: string
  // The owner's actor id. This read is ALWAYS owner-scoped (the collection is
  // resolved by id + this owner), for both projections. 'public' here is the
  // owner previewing their own public projection (approved members, public-only
  // posts); truly unauthenticated public reads go through
  // getPublicCollectionTimeline instead.
  actorId: string
  projection?: 'owner' | 'public'
  // Hydration-only viewer; see GetPublicCollectionTimelineParams. Defaults to
  // the owner, so the owner's own public preview still shows their state.
  currentActorId?: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}
export type GetPublicCollectionTimelineParams = {
  id: string
  // The signed-in reader, for hydration only. `projection` decides WHICH
  // statuses this feed contains; this decides whose like/bookmark/reaction
  // state they carry. A public feed rendered for a signed-in viewer still shows
  // interactive controls, so those controls must reflect that viewer.
  currentActorId?: string
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}
export type AddStatusToCollectionTimelinesParams = {
  status: Status
}
export type GetApprovedCollectionMembersParams = {
  id: string
  actorId: string
}
// A featured member's ActivityPub id and actor type (Person/Service/Group/…),
// resolved from the local `actors` table (defaulting to 'Person' when unknown).
export type ApprovedCollectionMember = {
  id: string
  type: string
}
// A raw collection membership row (an "item" in the Mastodon 4.6 vocabulary):
// the stable item id plus the member, consent state, and add time. Exposed as
// stored — mapping featureState to the spec `state` vocabulary happens in the
// serializer (lib/services/collections/serializers.ts).
export type CollectionItemRow = {
  id: string
  targetActorId: string
  featureState: CollectionFeatureState
  createdAt: number
}
export type GetCollectionItemsParams = {
  // Collection ids (public UUIDs), not seqs. Non-owner-scoped: callers gate
  // visibility BEFORE asking for items.
  collectionIds: string[]
  // Only approved (publicly consented) items when true — the public projection.
  approvedOnly?: boolean
  // Return at most this many items (oldest-first) per collection. Omit to load
  // every member; public callers that only embed a preview must set it so the
  // read does not scale with the collection's size.
  limitPerCollection?: number
}
export type GetCollectionItemParams = { collectionId: string; itemId: string }
export type GetCollectionItemByAccountParams = {
  collectionId: string
  targetActorId: string
}
// Owner-scoped removal addressed by the CollectionItem id (Mastodon 4.6
// `DELETE /collections/:id/items/:item_id`).
export type RemoveCollectionItemByIdParams = {
  id: string
  actorId: string
  itemId: string
}
export type GetAccountCollectionsParams = {
  ownerActorId: string
  // Only discoverable (visibility 'public') collections when true — what
  // strangers and anonymous viewers may list.
  publicOnly?: boolean
  limit?: number
  offset?: number
}
export type GetCollectionsFeaturingAccountParams = {
  targetActorId: string
  // The authenticated caller: sees their own collections featuring the target
  // regardless of state/visibility, and other owners' collections only when
  // public with an approved (consented) membership.
  viewerActorId: string
  limit?: number
  offset?: number
}
// Item counts keyed by collection id, non-owner-scoped (callers gate
// visibility). Collections with no matching items are present with 0.
export type CountCollectionItemsParams = {
  collectionIds: string[]
  approvedOnly?: boolean
}

export interface CollectionDatabase {
  createCollection(params: CreateCollectionParams): Promise<Collection>
  updateCollection(params: UpdateCollectionParams): Promise<Collection | null>
  getCollection(params: GetCollectionParams): Promise<Collection | null>
  // Non-owner-scoped lookup by id (see GetCollectionByIdParams).
  getCollectionById(params: GetCollectionByIdParams): Promise<Collection | null>
  getCollections(params: GetCollectionsParams): Promise<Collection[]>
  deleteCollection(params: DeleteCollectionParams): Promise<boolean>
  // Member counts keyed by collection id. Collections with no (matching) members
  // are present in the result with a count of 0.
  getCollectionMemberCounts(
    params: GetCollectionMemberCountsParams
  ): Promise<Record<string, number>>
  // Adds members (idempotently) and returns the actor ids that were NEWLY added
  // (not already members), so callers can notify only the newly-added members.
  addCollectionMembers(params: AddCollectionMembersParams): Promise<string[]>
  removeCollectionMembers(params: RemoveCollectionMembersParams): Promise<void>
  // Member-facing approve/revoke of the caller's own membership. Returns true
  // when a membership row was updated, false when none matched.
  setOwnCollectionMembershipState(
    params: SetOwnCollectionMembershipStateParams
  ): Promise<boolean>
  getCollectionMembers(
    params: GetCollectionMembersParams
  ): Promise<CollectionMembersPage>
  // Approved members (id + actor type), oldest-first, owner-scoped. Used to
  // build the FEP-7aa9 FeaturedCollection ActivityPub representation, where each
  // FeaturedItem carries the member's actual `featuredObjectType`.
  getApprovedCollectionMembers(
    params: GetApprovedCollectionMembersParams
  ): Promise<ApprovedCollectionMember[]>
  // Membership rows ("items") grouped by collection id, oldest-first.
  getCollectionItems(
    params: GetCollectionItemsParams
  ): Promise<Record<string, CollectionItemRow[]>>
  getCollectionItem(
    params: GetCollectionItemParams
  ): Promise<CollectionItemRow | null>
  getCollectionItemByAccount(
    params: GetCollectionItemByAccountParams
  ): Promise<CollectionItemRow | null>
  countCollectionItems(
    params: CountCollectionItemsParams
  ): Promise<Record<string, number>>
  // An account's collections for a viewer projection (publicOnly for
  // strangers), createdAt-ascending with limit/offset paging.
  getAccountCollections(
    params: GetAccountCollectionsParams
  ): Promise<Collection[]>
  // ALL collections featuring an account that the viewer may see: the
  // viewer's own plus other owners' public collections with an approved
  // membership.
  getCollectionsFeaturingAccount(
    params: GetCollectionsFeaturingAccountParams
  ): Promise<Collection[]>
  // Returns false when the collection is not owned by the actor or the item
  // does not exist.
  removeCollectionItemById(
    params: RemoveCollectionItemByIdParams
  ): Promise<boolean>
  getCollectionTimeline(params: GetCollectionTimelineParams): Promise<Status[]>
  // Read a collection's PUBLIC feed by id without owner scoping. Returns null
  // when the collection does not exist, is private, or has the feed disabled
  // (so the route can return 404); otherwise the approved/public-only statuses.
  getPublicCollectionTimeline(
    params: GetPublicCollectionTimelineParams
  ): Promise<Status[] | null>
  // Fan a newly created status into every collection whose membership includes
  // the status author (capped per collection). Called from addStatusToTimelines.
  addStatusToCollectionTimelines(
    params: AddStatusToCollectionTimelinesParams
  ): Promise<void>
}

// ============================================================================
// Followed Tag Database
// ============================================================================

export type {
  FollowTagParams,
  FollowedTag,
  FollowedTagDatabase,
  GetFollowedTagsParams,
  IsFollowingTagParams,
  UnfollowTagParams
} from '@/lib/database/domains/followedTag/types'

// ============================================================================
// Featured Tag Database
// ============================================================================

// A stored featured-tag row. `name` keeps the original display casing.
export type FeaturedTag = {
  id: string
  actorId: string
  name: string
  createdAt: number
}
// A featured tag with statuses_count / last_status_at derived at read time
// from the actor's own public statuses carrying the hashtag.
export type FeaturedTagWithStats = FeaturedTag & {
  statusesCount: number
  // Epoch milliseconds of the most recent matching status, or null.
  lastStatusAt: number | null
}
// The most-used hashtag among an actor's statuses, for suggestions.
export type FeaturedTagSuggestion = {
  name: string
  statusesCount: number
  lastStatusAt: number | null
}
export type GetFeaturedTagsParams = { actorId: string }
export type GetFeaturedTagByNameParams = { actorId: string; name: string }
export type CreateFeaturedTagParams = { actorId: string; name: string }
export type DeleteFeaturedTagParams = { actorId: string; id: string }
export type GetFeaturedTagSuggestionsParams = {
  actorId: string
  limit?: number
}
export type CountFeaturedTagsParams = { actorId: string }

export interface FeaturedTagDatabase {
  // The number of tags an actor features — used to enforce Mastodon's
  // per-account FeaturedTag::LIMIT before creating a new one.
  countFeaturedTags(params: CountFeaturedTagsParams): Promise<number>
  // Featured tags for an actor, ordered by statuses_count desc (Mastodon's
  // ordering), then createdAt desc as a stable tie-breaker.
  getFeaturedTags(
    params: GetFeaturedTagsParams
  ): Promise<FeaturedTagWithStats[]>
  getFeaturedTagByName(
    params: GetFeaturedTagByNameParams
  ): Promise<FeaturedTagWithStats | null>
  createFeaturedTag(
    params: CreateFeaturedTagParams
  ): Promise<FeaturedTagWithStats>
  // Owner-scoped delete; returns the removed row or null when not found/owned.
  deleteFeaturedTag(
    params: DeleteFeaturedTagParams
  ): Promise<FeaturedTag | null>
  getFeaturedTagSuggestions(
    params: GetFeaturedTagSuggestionsParams
  ): Promise<FeaturedTagSuggestion[]>
}

// ============================================================================
// Scheduled Status Database
// ============================================================================

export type {
  CreateScheduledStatusParams,
  DeleteScheduledStatusParams,
  GetScheduledStatusByIdParams,
  GetScheduledStatusParams,
  GetScheduledStatusesParams,
  ScheduledStatusData,
  ScheduledStatusDatabase,
  UpdateScheduledStatusAtParams
} from '@/lib/database/domains/scheduledStatus/types'

// ============================================================================
// Instance Rule Database
// ============================================================================

export type {
  CreateInstanceRuleParams,
  DeleteInstanceRuleParams,
  InstanceRuleData,
  InstanceRuleDatabase,
  UpdateInstanceRuleParams
} from '@/lib/database/domains/instanceRule/types'

// ============================================================================
// Server Setting Database
// ============================================================================

export type {
  DeleteServerSettingParams,
  ServerSettingData,
  ServerSettingDatabase,
  ServerSettingValue,
  SetServerSettingParams
} from '@/lib/database/domains/serverSetting/types'

// ============================================================================
// Relay Database
// ============================================================================

export type {
  CreateRelayParams,
  DeleteRelayParams,
  GetRelayByActorIdParams,
  GetRelayByFollowActivityIdParams,
  GetRelayByIdParams,
  RelayData,
  RelayDatabase,
  UpdateRelayParams
} from '@/lib/database/domains/relay/types'

// ============================================================================
// Suggestion Database
// ============================================================================

export type {
  DismissSuggestionParams,
  FriendsOfFriendsSuggestion,
  GetFriendsOfFriendsSuggestionsParams,
  SuggestionDatabase
} from '@/lib/database/domains/suggestion/types'

// ============================================================================
// Announcement Database
// ============================================================================

export type {
  AnnouncementData,
  AnnouncementDatabase,
  AnnouncementReactionParams,
  AnnouncementReactionRollup,
  CreateAnnouncementParams,
  DeleteAnnouncementParams,
  GetActiveAnnouncementsParams,
  GetAnnouncementParams,
  GetAnnouncementReactionsParams,
  GetAnnouncementReadIdsParams,
  MarkAnnouncementReadParams,
  UpdateAnnouncementParams
} from '@/lib/database/domains/announcement/types'

// ============================================================================
// Trends Database
// ============================================================================

// A locally-trending hashtag computed live from the public statuses created
// within the requested day window. `uses` counts distinct statuses carrying
// the tag; `accounts` counts distinct status authors. `name` is the bare
// (no leading `#`) normalized tag name.
export type TrendingTag = {
  name: string
  uses: number
  accounts: number
}

// One UTC-day usage bucket for a tag. `dayBucketMs` is the epoch-millisecond
// start of the UTC day (Math.floor(createdAtMs / DAY_MS) * DAY_MS).
export type TagDailyHistoryPoint = {
  dayBucketMs: number
  uses: number
  accounts: number
}

export type GetTrendingTagsParams = {
  days: number
  limit: number
  offset: number
}
export type GetTagDailyHistoryParams = {
  // Bare (no leading `#`) normalized hashtag names.
  names: string[]
  days: number
}
export type GetTrendingStatusCandidateIdsParams = {
  days: number
}

export interface TrendsDatabase {
  // Hashtags on public Note/Poll statuses created within the last `days`
  // days, ranked by distinct status uses descending (tag name ascending as
  // the deterministic tiebreaker), sliced by offset/limit.
  getTrendingTags(params: GetTrendingTagsParams): Promise<TrendingTag[]>
  // Trending-status candidate ids: public, top-level (non-reply) Note/Poll
  // statuses authored by a local actor within the last `days` days, newest
  // first, capped at a safety bound. Unlike a small fixed newest-N timeline
  // slice this keeps the whole realistic windowed set so a highly-interacted
  // older-within-window status is not dropped before the service ranks it; the
  // cap only guards memory and the bind-variable limit against a pathological
  // backlog on a busy instance.
  getTrendingStatusCandidateIds(
    params: GetTrendingStatusCandidateIdsParams
  ): Promise<string[]>
  // Per-UTC-day usage buckets (newest first) for each requested name within
  // the last `days` days. Every requested name maps to an entry — possibly an
  // empty list — so routes can zero-fill missing days uniformly.
  getTagDailyHistory(
    params: GetTagDailyHistoryParams
  ): Promise<Map<string, TagDailyHistoryPoint[]>>
}

// ============================================================================
// Report Database
// ============================================================================

export { ReportCategory } from '@/lib/database/domains/report/types'
export type {
  AssignReportParams,
  CreateReportParams,
  GetAdminReportsParams,
  GetReportByIdParams,
  Report,
  ReportDatabase,
  UpdateReportCategoryParams
} from '@/lib/database/domains/report/types'

// ============================================================================
// Moderation Database
// ============================================================================

// The moderator actions recorded in the append-only `moderation_actions` audit
// log. `none` is an audit-only action (e.g. resolving a report with no state
// change). The rest mirror the admin account action matrix.
export const ModerationActionType = z.enum([
  'none',
  'disable',
  'enable',
  'sensitive',
  'unsensitive',
  'silence',
  'unsilence',
  'suspend',
  'unsuspend',
  'approve',
  'reject',
  'destroy'
])
export type ModerationActionType = z.infer<typeof ModerationActionType>

// Per-actor moderation state, read as epoch-millisecond timestamps (null when
// the state is not set). Only actors carrying at least one non-null state are
// returned by getModerationStatesForActors, so an absent map entry means the
// actor is not moderated.
export type ModerationStates = {
  suspendedAt: number | null
  silencedAt: number | null
  sensitizedAt: number | null
}

export type ModerationAction = {
  id: string
  targetActorId: string
  moderatorAccountId: string
  moderatorActorId: string | null
  action: ModerationActionType
  reportId: string | null
  text: string
  createdAt: number
}

export type SetActorSuspendedParams = { actorId: string; suspended: boolean }
export type SetActorSilencedParams = { actorId: string; silenced: boolean }
export type SetActorSensitizedParams = { actorId: string; sensitized: boolean }
export type SetAccountDisabledParams = { accountId: string; disabled: boolean }
export type ApproveAccountParams = { accountId: string }
export type RejectPendingAccountParams = { accountId: string }
export type GetModerationStatesForActorsParams = { actorIds: string[] }
export type CreateModerationActionParams = {
  targetActorId: string
  moderatorAccountId: string
  moderatorActorId?: string | null
  action: ModerationActionType
  reportId?: string | null
  text?: string
}
export type DeleteAllAccountSessionsParams = { accountId: string }
export type SetReportResolutionParams = {
  reportId: string
  // true → mark action_taken with the timestamp and moderator; false → reopen
  // (clear all three).
  resolved: boolean
  actionTakenByActorId?: string | null
}

export interface ModerationDatabase {
  // Stamp/clear the actor state columns. Idempotent: setting a state that is
  // already set refreshes the timestamp; clearing an unset state is a no-op.
  setActorSuspended(params: SetActorSuspendedParams): Promise<void>
  setActorSilenced(params: SetActorSilencedParams): Promise<void>
  setActorSensitized(params: SetActorSensitizedParams): Promise<void>
  // Login-level state, on the account row (no remote analogue).
  setAccountDisabled(params: SetAccountDisabledParams): Promise<void>
  // Idempotently mark an account approved (sets approvedAt only when null).
  approveAccount(params: ApproveAccountParams): Promise<void>
  // Delete a registration-pending account (approvedAt null) and all its actors
  // in one transaction. Returns false (and changes nothing) for an already
  // approved account.
  rejectPendingAccount(params: RejectPendingAccountParams): Promise<boolean>
  // Batch-load the moderation state for a set of actor ids in one query. Only
  // moderated actors (≥1 non-null state) appear in the returned map.
  getModerationStatesForActors(
    params: GetModerationStatesForActorsParams
  ): Promise<Map<string, ModerationStates>>
  // Append an immutable audit-log row and return it.
  createModerationAction(
    params: CreateModerationActionParams
  ): Promise<ModerationAction>
  // Revoke every better-auth session for the account (used by disable/suspend).
  deleteAllAccountSessions(
    params: DeleteAllAccountSessionsParams
  ): Promise<void>
  // Resolve/reopen a report's action-taken workflow columns. Returns true when
  // a matching report row was updated. Shared by the account action endpoint
  // (resolve on moderation) and the admin reports API.
  setReportResolution(params: SetReportResolutionParams): Promise<boolean>
}

// ============================================================================
// Admin Accounts (Admin::Account listing/lookup)
// ============================================================================

// One actor row plus its owning account row (null for remote actors). The
// Admin::Account serializer hydrates both plus session IPs and the public
// Account entity.
export type AdminAccountRecord = {
  actor: SQLActor
  account: SQLAccount | null
}

export type AdminAccountIp = { ip: string; usedAt: number }

export type GetAdminAccountsParams = {
  limit?: number
  // Locality: local = account-backed on this instance; remote = foreign actor.
  local?: boolean
  remote?: boolean
  // Status filters (v1 booleans; v2 `status`/`origin` map onto these).
  active?: boolean
  pending?: boolean
  disabled?: boolean
  silenced?: boolean
  suspended?: boolean
  sensitized?: boolean
  // Text filters.
  username?: string
  displayName?: string
  byDomain?: string
  email?: string
  ip?: string
  staff?: boolean
  // Keyset cursors on (createdAt desc, id) — actor-URL ids.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export type GetAdminAccountParams = { actorId: string }
export type GetAdminAccountRecordsParams = { actorIds: string[] }
export type GetSessionIpsForAccountsParams = { accountIds: string[] }

export interface AdminAccountDatabase {
  // Actor-driven, filter/keyset-paginated listing for the admin accounts API.
  getAdminAccounts(
    params: GetAdminAccountsParams
  ): Promise<AdminAccountRecord[]>
  // Single Admin::Account record by actor id (URL form), or null.
  getAdminAccount(
    params: GetAdminAccountParams
  ): Promise<AdminAccountRecord | null>
  // Batch Admin::Account records by actor ids (URL form); order not guaranteed.
  // Used to hydrate the four embedded accounts on Admin::Report.
  getAdminAccountRecords(
    params: GetAdminAccountRecordsParams
  ): Promise<AdminAccountRecord[]>
  // Latest-first session IPs per account (local accounts only carry sessions).
  getSessionIpsForAccounts(
    params: GetSessionIpsForAccountsParams
  ): Promise<Map<string, AdminAccountIp[]>>
}

// ============================================================================
// Account Note Database
// ============================================================================

export type {
  AccountNoteDatabase,
  GetAccountNoteParams,
  UpsertAccountNoteParams
} from '@/lib/database/domains/accountNote/types'

// ============================================================================
// Endorsement Database
// ============================================================================

export type {
  CreateEndorsementParams,
  DeleteEndorsementParams,
  EndorsementDatabase,
  GetEndorsementParams,
  GetEndorsementsParams
} from '@/lib/database/domains/endorsement/types'

// ============================================================================
// Filter Database
// ============================================================================

export type {
  ActiveFilterRecord,
  AddFilterKeywordParams,
  AddFilterStatusParams,
  CreateFilterKeywordInput,
  CreateFilterParams,
  DeleteFilterKeywordParams,
  DeleteFilterParams,
  DeleteFilterStatusParams,
  FilterDatabase,
  GetActiveFiltersForActorParams,
  GetFilterKeywordParams,
  GetFilterKeywordsParams,
  GetFilterParams,
  GetFilterRecordsForActorParams,
  GetFilterStatusParams,
  GetFilterStatusesParams,
  UpdateFilterKeywordInput,
  UpdateFilterKeywordParams,
  UpdateFilterParams
} from '@/lib/database/domains/filter/types'

// ============================================================================
// Server Filter Database (instance-wide, admin-authored)
// ============================================================================

export type {
  ActiveServerFilterRecord,
  CreateServerFilterParams,
  DeleteServerFilterParams,
  GetActiveServerFiltersParams,
  GetServerFilterParams,
  ServerFilterDatabase,
  UpdateServerFilterParams
} from '@/lib/database/domains/serverFilter/types'

// ============================================================================
// Like Database
// ============================================================================

export type {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  GetLikesParams,
  IsActorLikedStatusParams,
  Like,
  LikeDatabase
} from '@/lib/database/domains/like/types'

// ============================================================================
// Status Reaction Database (Misskey/Pleroma emoji reactions)
// ============================================================================

export type {
  CreateStatusReactionParams,
  DeleteStatusReactionParams,
  GetStatusReactionActorsParams,
  GetStatusReactionRollupsParams,
  StatusReactionActor,
  StatusReactionDatabase,
  StatusReactionRollup
} from '@/lib/database/domains/statusReaction/types'

// ============================================================================
// Bookmark Database
// ============================================================================

export type {
  BookmarkDatabase,
  CreateBookmarkParams,
  DeleteBookmarkParams,
  GetBookmarksParams,
  IsActorBookmarkedStatusParams
} from '@/lib/database/domains/bookmark/types'

// ============================================================================
// Status Quote Database (FEP-044f / Mastodon 4.5 quote edges)
// ============================================================================

export type {
  CreateStatusQuoteParams,
  GetQuotingStatusIdsParams,
  GetStatusQuoteByAuthorizationUriParams,
  GetStatusQuoteByQuoteRequestIdParams,
  GetStatusQuoteParams,
  StatusQuoteDatabase,
  StatusQuoteRecord,
  UpdateStatusQuoteStateParams
} from '@/lib/database/domains/statusQuote/types'

// ============================================================================
// Link Preview Database (Mastodon PreviewCard)
// ============================================================================

export type {
  DeleteStatusLinkPreviewParams,
  GetLinkPreviewParams,
  GetStatusLinkPreviewsParams,
  LinkPreviewDatabase,
  LinkPreviewFetchStatus,
  LinkPreviewRecord,
  LinkStatusLinkPreviewParams,
  RecordLinkPreviewFailureParams,
  UpsertLinkPreviewParams
} from '@/lib/database/domains/linkPreview/types'

// ============================================================================
// Media Database
// ============================================================================

interface MetaData {
  width: number
  height: number
  upload?: {
    state: 'pending' | 'verified'
    checksumSha1?: string
    checksumSha1Base64?: string
    contentType?: string
    size?: number
    verifiedAt?: number
    // The key the client's presigned PUT targeted, recorded when the stripped
    // copy is swapped in. The presigned URL outlives the swap, so a re-PUT can
    // recreate an object here; media deletion removes this key too.
    clientPath?: string
  }
}

interface BaseMedia {
  actorId: string
  original: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
    fileName?: string
  }
  thumbnail?: {
    path: string
    bytes: number
    mimeType: string
    metaData: MetaData
  }
  description?: string
  // Focal point for cropping previews, each axis in [-1.0, 1.0]. Mastodon's
  // MediaAttachment `meta.focus`.
  focus?: { x: number; y: number }
  blurhash?: string | null
  // Subject, EXIF-derived and owner-edited details (see MediaDetailsRecord).
  // Omitted fields take the column default. The lookup-owned details are not
  // writable here (see UpdateMediaDetailsParams).
  details?: UpdateMediaDetailsParams
}

// A processed thumbnail ready to persist on an existing media row. Mirrors the
// shape `createMedia` already accepts for `thumbnail`.
export type MediaThumbnailInput = {
  path: string
  bytes: number
  mimeType: string
  metaData: { width: number; height: number }
}

export interface Media extends Omit<BaseMedia, 'details'> {
  id: string
  // Always present on a row read from the database; may be absent on a Media
  // built by hand (tests, in-memory fixtures).
  details?: MediaDetailsRecord
}

export interface MediaWithStatus extends Media {
  statusId?: string
}

export interface PaginatedMediaWithStatus {
  items: MediaWithStatus[]
  total: number
}

export type CreateMediaParams = BaseMedia

export type CreateAttachmentParams = {
  actorId: string
  statusId: string
  mediaType: string
  url: string
  width?: number
  height?: number
  name?: string
  mediaId?: string
  createdAt?: number
  blurhash?: string | null
  focus?: { x: number; y: number } | null
  thumbnailUrl?: string | null
  playbackType?: 'gifv' | 'video' | 'unknown' | null
}
export type UpdateAttachmentPlaybackParams = {
  id: string
  // The status the attachment belongs to. An attachment id alone is not enough:
  // remote attachment ids can be attacker-chosen strings, so the update is
  // scoped to the status being enriched and can never reach another one's row.
  statusId: string
  playbackType: 'gifv' | 'video' | 'unknown'
  thumbnailUrl?: string | null
  onlyIfUnset?: boolean
}
export type GetAttachmentsParams = {
  statusId: string
}
export type AttachmentWithMedia = Attachment & {
  mediaId?: string | null
}
export type GetAttachmentsWithMediaParams = {
  statusId: string
}
export type GetAttachmentsForActorParams = {
  actorId: string
  limit?: number
  maxCreatedAt?: number
  // Visibility of the STATUS each attachment hangs off, with the same meaning
  // and the same "all absent means no filter" default as GetActorStatusesParams
  // above — an attachment is exactly as readable as the post carrying it, so a
  // gallery must be scoped the same way its timeline is. Resolve these with
  // `resolveActorStatusesAudience` rather than spelling them out.
  publicOnly?: boolean
  visibleToActorId?: string | null
  includeFollowersOnly?: boolean
  followersAudience?: string | null
}
export type GetMediasForAccountParams = {
  accountId: string
  limit?: number
  page?: number
  maxCreatedAt?: number
}
export type GetStorageUsageForAccountParams = {
  accountId: string
}
export type DeleteMediaParams = {
  mediaId: string
}
export type DeleteMediaForAccountParams = {
  mediaId: string
  accountId: string
}
// Mirrors Mastodon's destroy semantics: `not-found` (missing or owned by another
// account) → 404, `in-use` (still attached to a posted status) → 422, `deleted`
// → 200. On `deleted`, `files` carries the storage paths captured inside the
// delete transaction so the caller can remove them without a separate (racy)
// prefetch.
export type DeleteMediaForAccountResult =
  | { status: 'deleted'; files: string[] }
  | { status: 'not-found' }
  | { status: 'in-use' }
export type DeleteAttachmentsByIdsParams = {
  attachmentIds: string[]
}
export type GetMediaByIdParams = {
  mediaId: string
  accountId: string
}
export type GetMediaByIdsForAccountParams = {
  mediaIds: string[]
  accountId: string
}
export type UpdateMediaParams = {
  mediaId: string
  accountId: string
  // Narrows the owner check from the account to one of its actors. Set by
  // actor-scoped callers (a status edit's media_attributes), whose OAuth token
  // is bound to a single actor.
  actorId?: string
  description?: string | null
  focus?: { x: number; y: number }
  blurhash?: string | null
  thumbnail?: MediaThumbnailInput
  // Presence semantics, like the fields above: an omitted key is left alone and
  // an explicit null clears the column. `details` is narrowed to what an update
  // may write — `inGallery` is a boolean, never null.
  details?: UpdateMediaDetailsParams
}
// The lookup-owned details (`MEDIA_LOOKUP_OWNED_DETAILS`) are not writable
// here: the update resets them itself when the subject or the coordinates
// change, and only the lookup methods below set them.
export type UpdateMediaDetailsParams = Partial<
  Omit<MediaDetailsRecord, 'inGallery' | MediaLookupOwnedDetail>
> & { inGallery?: boolean }
export type UpdateMediaResult = {
  media: Media
  // Path of the thumbnail this update replaced, captured inside the update
  // transaction so the caller can delete it race-free. null when no existing
  // thumbnail was replaced.
  replacedThumbnailPath: string | null
}
export type MarkMediaUploadVerifiedParams = {
  mediaId: string
  accountId: string
  verifiedAt: number
  // The dimensions probed from the uploaded bytes, replacing the ones the
  // client declared when it asked for the presigned URL.
  dimensions?: { width: number; height: number }
  // The size of the original after completion rewrote it (metadata stripped),
  // replacing the declared size. The account's media usage counter moves by the
  // difference.
  originalBytes?: number
  // The key the rewritten original was stored under. Completion writes the
  // stripped copy to a NEW key and swaps it in here, so the client's upload is
  // never overwritten while the row is still pending.
  originalPath?: string
  // The client's presign key being replaced by `originalPath`; persisted in
  // `upload.clientPath` so deletion can remove a re-PUT at that key.
  clientPath?: string
  // The details built from the client's bytes before they were stripped (EXIF
  // date, gear, place, the gallery default). Written in the same conditional
  // pending → verified update as `originalPath`, so they commit with the swap
  // or not at all: once the client's object is deleted they cannot be
  // rebuilt. Same presence semantics as `UpdateMediaParams.details`.
  details?: UpdateMediaDetailsParams
}
// `transitioned` is true only for the one call whose conditional
// pending → verified update changed the row; a concurrent or repeated
// completion gets the already-verified media back with `transitioned: false`
// and must not apply its own side effects (the usage counter moves only on the
// transition).
export type MarkMediaUploadVerifiedResult = {
  media: Media
  transitioned: boolean
}

export type GetMediaWithAttachedStatusIdsParams = {
  mediaId: string
}
// A media row together with the statuses it is attached to, for the public
// details endpoint — which has no account to scope by and therefore must be
// paired with a status visibility check.
export type MediaWithAttachedStatusIds = {
  media: Media
  statusIds: string[]
}

// Compare-and-set writes of a lookup's result. `expect` holds the values the
// lookup read; the write lands only if the row still has them (null compares
// as IS NULL), so an owner edit made while the lookup ran wins. Both return
// whether the row was written.
export type SetMediaSubjectLookupParams = {
  mediaId: string
  expect: {
    subjectName: string | null
    subjectScientificName: string | null
    subjectTaxonKey: string | null
    // Optional: compared only when given.
    subjectCategory?: MediaSubjectCategory | null
  }
  patch: {
    subjectLookupStatus: MediaLookupStatus | null
    // Omitted keys are left alone. A resolved taxon must carry a category
    // (`NE` when GBIF has no assessment): `resolved` with none keeps the place
    // withheld.
    subjectIucnCategory?: IucnCategory | null
    subjectTaxonKey?: string | null
    subjectTaxonPath?: string[] | null
    // Epoch milliseconds; defaults to now.
    subjectLookupAt?: number
  }
}
export type SetMediaPlaceLookupParams = {
  mediaId: string
  expect: {
    placeLatitude: number | null
    placeLongitude: number | null
  }
  patch: {
    placeLookupStatus: MediaLookupStatus | null
    // Epoch milliseconds; defaults to now.
    placeLookupAt?: number
    // Omitted keys are left alone.
    placeCountryCode?: string | null
    // Written (with `placeNameSource = 'geocoder'`) only when the stored name
    // is null or was itself the geocoder's; an owner's name is never replaced.
    placeName?: string | null
  }
}
// Owner-only subject suggestions; null clears them. A blob over
// `MAX_SUBJECT_SUGGESTIONS_BYTES` is refused (returns false).
export type SetMediaSubjectSuggestionsParams = {
  mediaId: string
  suggestions: MediaSubjectSuggestions | null
}

export interface MediaDatabase {
  setMediaSubjectLookup(params: SetMediaSubjectLookupParams): Promise<boolean>
  setMediaPlaceLookup(params: SetMediaPlaceLookupParams): Promise<boolean>
  setMediaSubjectSuggestions(
    params: SetMediaSubjectSuggestionsParams
  ): Promise<boolean>
  createMedia(params: CreateMediaParams): Promise<Media | null>
  getMediaWithAttachedStatusIds(
    params: GetMediaWithAttachedStatusIdsParams
  ): Promise<MediaWithAttachedStatusIds | null>
  markMediaUploadVerified(
    params: MarkMediaUploadVerifiedParams
  ): Promise<MarkMediaUploadVerifiedResult | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  updateAttachmentPlayback(
    params: UpdateAttachmentPlaybackParams
  ): Promise<boolean>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
  getAttachmentsWithMedia(
    params: GetAttachmentsWithMediaParams
  ): Promise<AttachmentWithMedia[]>
  getAttachmentsForActor(
    params: GetAttachmentsForActorParams
  ): Promise<Attachment[]>
  getMediasWithStatusForAccount(
    params: GetMediasForAccountParams
  ): Promise<PaginatedMediaWithStatus>
  getMediaByIdForAccount(params: GetMediaByIdParams): Promise<Media | null>
  getMediaByIdsForAccount(
    params: GetMediaByIdsForAccountParams
  ): Promise<Media[]>
  updateMedia(params: UpdateMediaParams): Promise<UpdateMediaResult | null>
  getStorageUsageForAccount(
    params: GetStorageUsageForAccountParams
  ): Promise<number>
  deleteAttachmentsByIds(params: DeleteAttachmentsByIdsParams): Promise<number>
  deleteMedia(params: DeleteMediaParams): Promise<boolean>
  // Owner-scoped delete that only removes media not yet attached to a status.
  // Returns `not-found` when missing/owned by another account, `in-use` when
  // already attached to a posted status, and `deleted` on success.
  deleteMediaForAccount(
    params: DeleteMediaForAccountParams
  ): Promise<DeleteMediaForAccountResult>
}

// ============================================================================
// Notification Database
// ============================================================================

export { NotificationType } from '@/lib/database/domains/notification/types'
export type {
  CreateNotificationParams,
  GetNotificationRequestParams,
  GetNotificationRequestsParams,
  GetNotificationsCountParams,
  GetNotificationsParams,
  MarkNotificationsReadParams,
  Notification,
  NotificationDatabase,
  NotificationGroupKeyParams,
  NotificationRequest,
  ResolveNotificationRequestsParams
} from '@/lib/database/domains/notification/types'

// ============================================================================
// Push Subscription Database
// ============================================================================

export type {
  CreatePushSubscriptionParams,
  DeletePushSubscriptionParams,
  GetPushSubscriptionForActorParams,
  GetPushSubscriptionsForActorParams,
  PushAlerts,
  PushPolicy,
  PushSubscription,
  PushSubscriptionDatabase,
  UpdatePushSubscriptionParams
} from '@/lib/database/domains/pushSubscription/types'

// ============================================================================
// Notification Policy (stored on actor settings)
// ============================================================================

export const NotificationPolicyValue = z.enum(['accept', 'filter', 'drop'])
export type NotificationPolicyValue = z.infer<typeof NotificationPolicyValue>

export interface NotificationPolicy {
  for_not_following: NotificationPolicyValue
  for_not_followers: NotificationPolicyValue
  for_new_accounts: NotificationPolicyValue
  for_private_mentions: NotificationPolicyValue
  for_limited_accounts: NotificationPolicyValue
}

// Mastodon's default policy accepts everything; filtering is strictly opt-in.
export const DEFAULT_NOTIFICATION_POLICY: NotificationPolicy = {
  for_not_following: 'accept',
  for_not_followers: 'accept',
  for_new_accounts: 'accept',
  for_private_mentions: 'accept',
  for_limited_accounts: 'accept'
}

export type UpdateNotificationPolicyParams = {
  actorId: string
} & Partial<NotificationPolicy>

// ============================================================================
// OAuth Database
// ============================================================================

// OAuth scope vocabulary. This is the compatibility contract with Mastodon
// clients: Mastodon rejects unknown scopes both at app registration and at the
// authorize endpoint, so any scope a real Mastodon client may request must be
// recognized here or the client cannot connect at all. The list mirrors the
// documented Mastodon OAuth scopes (https://docs.joinmastodon.org/api/oauth-scopes/),
// plus the OpenID Connect scopes (openid/email) this server also issues, and
// the legacy server-specific `read:conversations` scope kept for existing
// clients. Granting a coarse scope (read/write) still satisfies routes that
// require a granular one via the scope hierarchy in OAuthGuard.
export const Scope = z.enum([
  // OpenID Connect
  'openid',
  'profile',
  'email',
  // Read
  'read',
  'read:accounts',
  'read:blocks',
  'read:bookmarks',
  'read:collections',
  'read:conversations',
  'read:favourites',
  'read:filters',
  'read:follows',
  'read:lists',
  'read:mutes',
  'read:notifications',
  'read:search',
  'read:statuses',
  // Write
  'write',
  'write:accounts',
  'write:blocks',
  'write:bookmarks',
  'write:collections',
  'write:conversations',
  'write:favourites',
  'write:filters',
  'write:follows',
  'write:lists',
  'write:media',
  'write:mutes',
  'write:notifications',
  'write:reports',
  'write:statuses',
  // Aggregate / push
  'follow',
  'push',
  // Admin. The aggregate admin scopes plus Mastodon's documented granular admin
  // scopes. These are recognized so admin clients can register and authorize
  // with specific granular scopes. AdminApiGuard accepts the aggregate
  // admin:read / admin:write, or a route's own granular scope when the route
  // opts in with `{ resource }`; the coarse read / write never satisfy it.
  'admin:read',
  'admin:read:accounts',
  'admin:read:reports',
  'admin:read:domain_allows',
  'admin:read:domain_blocks',
  'admin:read:ip_blocks',
  'admin:read:email_domain_blocks',
  'admin:read:canonical_email_blocks',
  'admin:write',
  'admin:write:accounts',
  'admin:write:reports',
  'admin:write:domain_allows',
  'admin:write:domain_blocks',
  'admin:write:ip_blocks',
  'admin:write:email_domain_blocks',
  'admin:write:canonical_email_blocks'
])
export type Scope = z.infer<typeof Scope>

// Single source of truth for the scopes the server registers, authorizes, and
// advertises in OAuth/OpenID metadata. Derived from the enum so the registration
// validator, better-auth provider config, and `scopes_supported` can never drift.
export const UsableScopes = Scope.options

export { GetClientFromIdParams } from '@/lib/database/domains/oauth/types'
export type {
  CreateOAuthAccessTokenParams,
  ExtendOAuthAccessTokenParams,
  GetAccountConnectedAppsParams,
  OAuthDatabase,
  RevokeAccountConnectedAppParams
} from '@/lib/database/domains/oauth/types'

// ============================================================================
// Timeline Database
// ============================================================================

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  minStatusId?: string | null
  sinceStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
  // Attachments-only filter (Mastodon `only_media`). Honored by the
  // LOCAL_PUBLIC and FEDERATED_PUBLIC timelines; other timelines ignore it.
  onlyMedia?: boolean
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
}
export type AddStatusToFederatedTimelineParams = {
  statusId: string
  statusActorId: string
}

export interface TimelineDatabase {
  getTimeline({
    timeline,
    actorId,
    minStatusId,
    maxStatusId,
    limit
  }: GetTimelineParams): Promise<Status[]>
  createTimelineStatus(params: CreateTimelineStatusParams): Promise<void>
  /**
   * Appends a remote, relay-ingested status to the materialized
   * `federated_timeline` (the Federated / "whole known network" feed). Idempotent
   * — a status already present is left untouched. The timeline read for
   * `Timeline.FEDERATED_PUBLIC` joins these rows back to `statuses`.
   */
  addStatusToFederatedTimeline(
    params: AddStatusToFederatedTimelineParams
  ): Promise<void>
  /**
   * Number of statuses visible on the local public timeline (the same set
   * `getTimeline({ timeline: LOCAL_PUBLIC })` pages over). Used to decide
   * whether the logged-out landing previews the public feed or shows the brand
   * hero. Pass `limit` to stop counting once that many are found (a bounded,
   * cheaper check when the caller only needs a threshold, not the exact total).
   */
  getLocalPublicStatusesCount(limit?: number): Promise<number>
}

// ============================================================================
// Admin Database
// ============================================================================

export type GetAllAccountsParams = {
  limit: number
  offset: number
}

export type GetAllAccountsResult = {
  accounts: Account[]
  total: number
}

export type GetAccountWithActorsParams = {
  accountId: string
}

export type GetAccountWithActorsResult = {
  account: Account
  actors: Actor[]
}

export interface ServiceStats {
  totalAccounts: number
  totalActors: number
  totalStatuses: number
  totalMediaFiles: number
  totalMediaBytes: number
  totalFitnessFiles: number
  totalFitnessBytes: number
}

export interface ServiceStatsBucket {
  bucketHour: number
  value: number
}

export type ServiceStatCounterType =
  | 'accounts'
  | 'actors'
  | 'statuses'
  | 'media-files'
  | 'media-bytes'
  | 'fitness-files'
  | 'fitness-bytes'

export const ALL_COUNTER_TYPES: ServiceStatCounterType[] = [
  'accounts',
  'actors',
  'statuses',
  'media-files',
  'media-bytes',
  'fitness-files',
  'fitness-bytes'
]

/** Max allowed time window for bucket queries (91 days) */
export const MAX_STATS_WINDOW_MS = 91 * 24 * 60 * 60 * 1000

export interface GetServiceStatsBucketsParams {
  counterType: ServiceStatCounterType
  startTime: number
  endTime: number
}

export type HashtagSortOrder = 'alphabetical' | 'recent' | 'count'

export interface AdminHashtag {
  name: string
  postCount: number
  latestPostAt: number | null
}

export interface GetAllHashtagsParams {
  limit: number
  offset: number
  sort: HashtagSortOrder
}

export interface GetAllHashtagsResult {
  hashtags: AdminHashtag[]
  total: number
}

export const DomainFederationRuleType = z.enum(['block', 'allow'])
export type DomainFederationRuleType = z.infer<typeof DomainFederationRuleType>

export const DomainBlockSeverity = z.enum(['noop', 'silence', 'suspend'])
export type DomainBlockSeverity = z.infer<typeof DomainBlockSeverity>

export interface DomainFederationRule {
  id: string
  domain: string
  type: DomainFederationRuleType
  createdAt: number
  updatedAt: number
}

export interface DomainBlock extends DomainFederationRule {
  type: 'block'
  severity: DomainBlockSeverity
  rejectMedia: boolean
  rejectReports: boolean
  privateComment: string | null
  publicComment: string | null
  obfuscate: boolean
  source: string | null
}

export interface DomainAllow extends DomainFederationRule {
  type: 'allow'
}

export type ListDomainFederationRulesParams = {
  type: DomainFederationRuleType
  limit?: number
  offset?: number
}

export type CreateDomainBlockParams = {
  domain: string
  severity?: DomainBlockSeverity
  rejectMedia?: boolean
  rejectReports?: boolean
  privateComment?: string | null
  publicComment?: string | null
  obfuscate?: boolean
  source?: string | null
}

export type UpdateDomainBlockParams = {
  id: string
  severity?: DomainBlockSeverity
  rejectMedia?: boolean
  rejectReports?: boolean
  privateComment?: string | null
  publicComment?: string | null
  obfuscate?: boolean
  source?: string | null
}

export type CreateDomainAllowParams = {
  domain: string
}

export type ImportDomainBlockParams = CreateDomainBlockParams

export type DomainFederationRuleStats = {
  blocks: number
  suspendBlocks: number
  silenceBlocks: number
  allows: number
  sourceBlocks: number
  sourceCounts: Record<string, number>
}

export interface AdminDatabase {
  getAllAccounts(params: GetAllAccountsParams): Promise<GetAllAccountsResult>
  getAccountWithActors(
    params: GetAccountWithActorsParams
  ): Promise<GetAccountWithActorsResult | null>
  getServiceStats(): Promise<ServiceStats>
  getServiceStatsBuckets(
    params: GetServiceStatsBucketsParams
  ): Promise<ServiceStatsBucket[]>
  getAllHashtags(params: GetAllHashtagsParams): Promise<GetAllHashtagsResult>
  getDomainBlocks(params?: {
    limit?: number
    offset?: number
    severities?: DomainBlockSeverity[]
    // Cursor pagination over the domain-ascending order (cursor = row id):
    // maxId pages forward, minId returns the page immediately before the
    // cursor, sinceId returns the top-of-list rows before the cursor. Any
    // cursor disables offset.
    maxId?: string
    minId?: string
    sinceId?: string
  }): Promise<DomainBlock[]>
  getDomainAllows(params?: {
    limit?: number
    offset?: number
    maxId?: string
    minId?: string
    sinceId?: string
  }): Promise<DomainAllow[]>
  getDomainBlockById(id: string): Promise<DomainBlock | null>
  getDomainAllowById(id: string): Promise<DomainAllow | null>
  getDomainBlockForDomain(domain: string): Promise<DomainBlock | null>
  getDomainAllowForDomain(domain: string): Promise<DomainAllow | null>
  getDomainBlocksForDomains(
    domains: string[]
  ): Promise<Record<string, DomainBlock | null>>
  getDomainAllowsForDomains(
    domains: string[]
  ): Promise<Record<string, DomainAllow | null>>
  getDomainFederationRuleStats(): Promise<DomainFederationRuleStats>
  createDomainBlock(params: CreateDomainBlockParams): Promise<DomainBlock>
  updateDomainBlock(
    params: UpdateDomainBlockParams
  ): Promise<DomainBlock | null>
  deleteDomainBlock(id: string): Promise<DomainBlock | null>
  createDomainAllow(params: CreateDomainAllowParams): Promise<DomainAllow>
  deleteDomainAllow(id: string): Promise<DomainAllow | null>
  importDomainBlocks(params: {
    blocks: ImportDomainBlockParams[]
  }): Promise<{ created: number; updated: number; skipped: number }>
}

export type {
  GetInstanceActivityParams,
  GetInstancePeersParams,
  InstanceActivityDatabase,
  InstanceActivityWeek
} from '@/lib/database/domains/instanceActivity/types'

// ============================================================================
// Custom Emoji Database
// ============================================================================

export type {
  CreateCustomEmojiParams,
  CustomEmojiDatabase,
  GetCustomEmojisParams,
  UpdateCustomEmojiParams
} from '@/lib/database/domains/customEmoji/types'

// ============================================================================
// Dead Letter Jobs Database
// ============================================================================

export type {
  CreateDeadLetterJobParams,
  DeadLetterJob,
  DeadLetterJobDatabase,
  DeadLetterJobStatus,
  GetDeadLetterJobsParams
} from '@/lib/database/domains/deadLetterJob/types'

// ============================================================================
// Queue Jobs Database (Option B - Transactional Outbox)
// ============================================================================

export type {
  ClaimQueueJobParams,
  ClaimedQueueJob,
  CreateQueueJobParams,
  FailQueueJobWithDeadLetterParams,
  GetDueQueueJobsParams,
  QueueJob,
  QueueJobDatabase,
  QueueJobStatus,
  ReplayQueueJobParams
} from '@/lib/database/domains/queueJob/types'
