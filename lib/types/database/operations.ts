import { z } from 'zod'

import { Timeline } from '@/lib/services/timelines/types'
import { ActorSettings, PostLineLimit } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor, ActorType } from '@/lib/types/domain/actor'
import { ActorDomainBlock } from '@/lib/types/domain/actorDomainBlock'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import { Block } from '@/lib/types/domain/block'
import { Bookmark } from '@/lib/types/domain/bookmark'
import {
  Collection,
  CollectionFeatureState,
  CollectionVisibility
} from '@/lib/types/domain/collection'
import { ConnectedApp } from '@/lib/types/domain/connected-app'
import { CustomEmojiData } from '@/lib/types/domain/customEmoji'
import { Endorsement } from '@/lib/types/domain/endorsement'
import {
  Filter,
  FilterAction,
  FilterContext,
  FilterKeyword,
  FilterStatus,
  ServerFilter
} from '@/lib/types/domain/filter'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { List, ListRepliesPolicy } from '@/lib/types/domain/list'
import { Mute } from '@/lib/types/domain/mute'
import { Relay, RelayState } from '@/lib/types/domain/relay'
import { Session } from '@/lib/types/domain/session'
import { Status, StatusType } from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import * as Mastodon from '@/lib/types/mastodon'
import { Client } from '@/lib/types/oauth2/client'

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
  // Mastodon `bot`/`discoverable` flags and `source.*` posting defaults.
  bot?: boolean
  discoverable?: boolean
  indexable?: boolean
  hideCollections?: boolean
  attributionDomains?: string[]
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
export type IsInternalActorParams = { actorId: string }
export type CancelActorDeletionParams = { actorId: string }
export type GetActorsScheduledForDeletionParams = { beforeDate: Date }
export type StartActorDeletionParams = { actorId: string }
export type DeleteActorDataParams = { actorId: string }

export interface ActorDatabase {
  createActor(params: CreateActorParams): Promise<Actor | null>
  createMastodonActor(
    params: CreateActorParams
  ): Promise<Mastodon.Account | null>
  getActorFromId(params: GetActorFromIdParams): Promise<Actor | null>
  getActorsFromIds(params: GetActorsFromIdsParams): Promise<Actor[]>
  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | null>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | null>
  getFederationSigningActor(): Promise<Actor | null>
  getMastodonActorFromEmail(
    params: GetActorFromEmailParams
  ): Promise<Mastodon.Account | null>
  getMastodonActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Mastodon.Account | null>
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
  updateActorFollowersCount(actorId: string): Promise<void>
  updateActorFollowingCount(actorId: string): Promise<void>
  increaseActorStatusCount(actorId: string, amount?: number): Promise<void>
  decreaseActorStatusCount(actorId: string, amount?: number): Promise<void>
  updateActorLastStatusAt(actorId: string, time: number): Promise<void>
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
  isInternalActor(params: IsInternalActorParams): Promise<boolean>
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
export type GetAccountFromProviderIdParams = {
  provider: string
  accountId: string
}
export type LinkAccountWithProviderParams = {
  accountId: string
  provider: string
  providerAccountId: string
}
export type VerifyAccountParams = {
  verificationCode: string
}
export type CreateCredentialProviderParams = {
  accountId: string
  passwordHash: string
}
export type CreateAccountSessionParams = {
  accountId: string
  token: string
  expireAt: number
  actorId?: string | null
}
export type GetAccountSessionParams = {
  token: string
}
export type GetAccountAllSessionsParams = {
  accountId: string
}
export type DeleteAccountSessionParams = {
  token: string
}
export type DeleteOtherAccountSessionsParams = {
  accountId: string
  // The session to keep (the device making the request). Every other session
  // for the account is revoked.
  exceptToken: string
}
export type UpdateAccountSessionParams = {
  token: string
  expireAt?: number
}

export type GetAccountProvidersParams = {
  accountId: string
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
export type SetSessionActorParams = { token: string; actorId: string }

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
export type UpdateAccountEmailParams = {
  accountId: string
  email: string
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
  createCredentialProvider(
    params: CreateCredentialProviderParams
  ): Promise<void>
  getAccountFromId(params: GetAccountFromIdParams): Promise<Account | null>
  getAccountFromEmail(
    params: GetAccountFromEmailParams
  ): Promise<Account | null>
  getAccountFromProviderId(
    params: GetAccountFromProviderIdParams
  ): Promise<Account | null>
  linkAccountWithProvider(
    params: LinkAccountWithProviderParams
  ): Promise<Account | null>
  verifyAccount(params: VerifyAccountParams): Promise<Account | null>

  createAccountSession(params: CreateAccountSessionParams): Promise<void>
  getAccountSession(
    params: GetAccountSessionParams
  ): Promise<{ account: Account; session: Session } | null>
  getAccountAllSessions(params: GetAccountAllSessionsParams): Promise<Session[]>
  updateAccountSession(params: UpdateAccountSessionParams): Promise<void>
  deleteAccountSession(params: DeleteAccountSessionParams): Promise<void>
  // Revoke every session for the account except `exceptToken`. Returns the
  // number of sessions revoked.
  deleteOtherAccountSessions(
    params: DeleteOtherAccountSessionsParams
  ): Promise<number>

  getAccountProviders(params: GetAccountProvidersParams): Promise<
    {
      provider: string
      providerId: string
      createdAt: number
      updatedAt: number
    }[]
  >
  unlinkAccountFromProvider(
    params: UnlinkAccountFromProviderParams
  ): Promise<void>

  createActorForAccount(params: CreateActorForAccountParams): Promise<string>
  getActorsForAccount(params: GetActorsForAccountParams): Promise<Actor[]>
  setDefaultActor(params: SetDefaultActorParams): Promise<void>
  setSessionActor(params: SetSessionActorParams): Promise<void>

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
  updateAccountEmail(params: UpdateAccountEmailParams): Promise<void>
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

  // The registered OAuth client (Mastodon "application") that authored the
  // status. Null when created through the web session.
  applicationName?: string | null
  applicationWebsite?: string | null

  createdAt?: number
}

export type CreateNoteParams = BaseCreateStatusParams

type BaseStatusParams = {
  statusId: string
}

export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> &
  BaseStatusParams & {
    attachments?: PostBoxAttachment[]
    // Omit to preserve the existing value; provide to overwrite.
    sensitive?: boolean
    language?: string | null
  }

export type UpdateNoteVisibilityParams = BaseStatusParams & {
  to: string[]
  cc: string[]
}

export type CreateAnnounceParams = Pick<
  BaseCreateStatusParams,
  'id' | 'actorId' | 'to' | 'cc' | 'createdAt'
> & {
  originalStatusId: string
}

export type CreatePollParams = BaseCreateStatusParams & {
  choices: string[]
  endAt: number
  pollType?: 'oneOf' | 'anyOf'
  // Mastodon poll[hide_totals]: hide per-option tallies until the poll expires.
  hideTotals?: boolean
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
}
export type GetStatusEditHistoryParams = BaseStatusParams
// A single superseded revision of a status (a row in `status_history`). `text`
// and `summary` are the content of that prior version; `supersededAt` is when it
// was replaced by the next version, which is the creation time of that next
// version.
export type StatusEditRevision = {
  text: string
  summary: string | null
  // Per-revision snapshots. Null on rows written before snapshotting existed;
  // readers fall back to the status's current values for those.
  sensitive: boolean | null
  attachments: Attachment[] | null
  pollOptions: string[] | null
  supersededAt: number
}
export type DeleteStatusParams = BaseStatusParams & {
  actorId?: string
}

export type GetStatusFromUrlParams = {
  url: string
}
export type GetStatusFromUrlHashParams = {
  urlHash: string
  actorId?: string
}

export type GetActorAnnouncedStatusIdParams = {
  actorId: string
  originalStatusId: string
}
export type CountStatusParams = {
  actorId: string
}

export type UpdatePollChoiceParams = {
  statusId: string
  choices: { title: string }[]
}

export type AddPollVoteParams = {
  actorId: string
  statusId: string
  choice: number
}

export type GetPollVotesParams = {
  actorId: string
  statusId: string
}

export type AddStatusTagParams = {
  actorId: string
  statusId: string
  type: TagType
  name: string
  value: string
  /**
   * For multi-hashtag insert flows only. Callers that set this for hashtag tags
   * must call indexHashtagSearchDocuments once after all skipped tags are
   * inserted.
   */
  skipSearchIndex?: boolean
}

export type GetActorStatusesCountParams = {
  actorId: string
  publicOnly?: boolean
}
export type GetActorStatusesParams = {
  actorId: string
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
  createAnnounce(params: CreateAnnounceParams): Promise<Status>
  createPoll(params: CreatePollParams): Promise<Status>
  updateNote(params: UpdateNoteParams): Promise<Status | null>
  updateNoteVisibility(
    params: UpdateNoteVisibilityParams
  ): Promise<Status | null>
  updatePoll(params: UpdatePollParams): Promise<Status | null>
  getStatus(params: GetStatusParams): Promise<Status | null>
  getStatusReplies(params: GetStatusRepliesParams): Promise<Status[]>
  getStatusEditHistory(
    params: GetStatusEditHistoryParams
  ): Promise<StatusEditRevision[]>
  getStatusFromUrl(params: GetStatusFromUrlParams): Promise<Status | null>
  getStatusFromUrlHash(
    params: GetStatusFromUrlHashParams
  ): Promise<Status | null>
  getActorAnnouncedStatusId(
    params: GetActorAnnouncedStatusIdParams
  ): Promise<string | null>
  hasActorAnnouncedStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<boolean>
  getActorAnnounceStatus(
    params: HasActorAnnouncedStatusParams
  ): Promise<Status | null>
  deleteStatus(params: DeleteStatusParams): Promise<void>
  countStatus(params: CountStatusParams): Promise<number>
  updatePollChoice(params: UpdatePollChoiceParams): Promise<void>
  addPollVote(params: AddPollVoteParams): Promise<void>
  getPollVotes(params: GetPollVotesParams): Promise<number[]>
  addStatusTag(params: AddStatusTagParams): Promise<void>
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

export type SetDetectedLanguageParams = {
  statusId: string
  language: string
  confidence?: number | null
}
export type GetDetectedLanguageParams = { statusId: string }
export type GetDetectedLanguagesParams = { statusIds: string[] }
export type ClearDetectedLanguageParams = { statusId: string }

export interface StatusDetectedLanguageDatabase {
  setDetectedLanguage(params: SetDetectedLanguageParams): Promise<void>
  getDetectedLanguage(params: GetDetectedLanguageParams): Promise<string | null>
  getDetectedLanguages(
    params: GetDetectedLanguagesParams
  ): Promise<Record<string, string>>
  // Removes a previously detected language, e.g. when re-detection on an edit
  // no longer yields a confident result — leaving the old row in place would
  // surface a stale language for the post's new content.
  clearDetectedLanguage(params: ClearDetectedLanguageParams): Promise<void>
}

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

export type CreateBlockParams = {
  actorId: string
  targetActorId: string
  uri: string
}
export type DeleteBlockParams = {
  actorId: string
  targetActorId: string
}
export type DeleteBlockByUriParams = {
  actorId: string
  uri: string
}
export type GetBlockParams = {
  actorId: string
  targetActorId: string
}
export type GetBlockByUriParams = {
  uri: string
}
export type IsBlockingParams = {
  actorId: string
  targetActorId: string
}
export type IsEitherBlockingParams = {
  actorIdA: string
  actorIdB: string
}
export type GetBlocksParams = {
  actorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type GetBlockRelationsParams = {
  actorIds: string[]
  targetActorIds: string[]
}
export type BlockRelation = Pick<Block, 'actorId' | 'targetActorId'>

export interface BlockDatabase {
  createBlock(params: CreateBlockParams): Promise<Block>
  deleteBlock(params: DeleteBlockParams): Promise<Block | null>
  deleteBlockByUri(params: DeleteBlockByUriParams): Promise<Block | null>
  getBlock(params: GetBlockParams): Promise<Block | null>
  getBlockByUri(params: GetBlockByUriParams): Promise<Block | null>
  isBlocking(params: IsBlockingParams): Promise<boolean>
  isEitherBlocking(params: IsEitherBlockingParams): Promise<boolean>
  getBlocks(params: GetBlocksParams): Promise<Block[]>
  getBlockRelations(params: GetBlockRelationsParams): Promise<BlockRelation[]>
}

// ============================================================================
// Actor Domain Block Database (user-level Mastodon domain blocks)
// ============================================================================

export type CreateActorDomainBlockParams = {
  actorId: string
  domain: string
}
export type DeleteActorDomainBlockParams = {
  actorId: string
  domain: string
}
export type IsDomainBlockedByActorParams = {
  actorId: string
  domain: string
}
export type GetActorDomainBlocksParams = {
  actorId: string
  // No limit = return every row (the timeline filter loads the viewer's full
  // set once per page request). Routes always pass an explicit limit.
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface ActorDomainBlockDatabase {
  createActorDomainBlock(
    params: CreateActorDomainBlockParams
  ): Promise<ActorDomainBlock>
  deleteActorDomainBlock(
    params: DeleteActorDomainBlockParams
  ): Promise<ActorDomainBlock | null>
  isDomainBlockedByActor(params: IsDomainBlockedByActorParams): Promise<boolean>
  getActorDomainBlocks(
    params: GetActorDomainBlocksParams
  ): Promise<ActorDomainBlock[]>
}

// ============================================================================
// Mute Database
// ============================================================================

export type CreateMuteParams = {
  actorId: string
  targetActorId: string
  notifications: boolean
  endsAt: number | null
}
export type DeleteMuteParams = {
  actorId: string
  targetActorId: string
}
export type GetMuteParams = {
  actorId: string
  targetActorId: string
}
export type IsMutingParams = {
  actorId: string
  targetActorId: string
}
export type GetMuteRelationsParams = {
  actorIds: string[]
  targetActorIds: string[]
}
export type MuteRelation = Pick<
  Mute,
  'actorId' | 'targetActorId' | 'notifications'
>
export type GetMutesParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export type MarkerTimeline = 'home' | 'notifications'

export interface MarkerRow {
  actorId: string
  timeline: MarkerTimeline
  lastReadId: string
  version: number
  updatedAt: number
}

export interface GetMarkersParams {
  actorId: string
  timelines: MarkerTimeline[]
}

export interface UpsertMarkerParams {
  actorId: string
  timeline: MarkerTimeline
  lastReadId: string
}

export interface MarkerDatabase {
  getMarkers(params: GetMarkersParams): Promise<MarkerRow[]>
  upsertMarker(params: UpsertMarkerParams): Promise<MarkerRow>
}

export interface MuteDatabase {
  createMute(params: CreateMuteParams): Promise<Mute>
  deleteMute(params: DeleteMuteParams): Promise<Mute | null>
  getMute(params: GetMuteParams): Promise<Mute | null>
  isMuting(params: IsMutingParams): Promise<boolean>
  getMuteRelations(params: GetMuteRelationsParams): Promise<MuteRelation[]>
  getMutes(params: GetMutesParams): Promise<Mute[]>
}

// ============================================================================
// Status (conversation) Mute Database
// ============================================================================

// `statusId` is the thread-root status id that identifies the muted
// conversation (see resolveConversationRootId).
export type CreateStatusMuteParams = { actorId: string; statusId: string }
export type DeleteStatusMuteParams = { actorId: string; statusId: string }
export type IsConversationMutedParams = { actorId: string; statusId: string }
export type GetActorMutedConversationRootIdsParams = { actorId: string }

export interface StatusMuteDatabase {
  createStatusMute(params: CreateStatusMuteParams): Promise<void>
  deleteStatusMute(params: DeleteStatusMuteParams): Promise<void>
  isConversationMuted(params: IsConversationMutedParams): Promise<boolean>
  getActorMutedConversationRootIds(
    params: GetActorMutedConversationRootIdsParams
  ): Promise<string[]>
}

// ============================================================================
// Idempotency Key Database
// ============================================================================

export type GetIdempotentStatusIdParams = { actorId: string; key: string }
export type SaveIdempotencyKeyParams = {
  actorId: string
  key: string
  statusId: string
}

export interface IdempotencyDatabase {
  getIdempotentStatusId(
    params: GetIdempotentStatusIdParams
  ): Promise<string | null>
  saveIdempotencyKey(params: SaveIdempotencyKeyParams): Promise<void>
}

// ============================================================================
// Translation Cache Database
// ============================================================================

export type GetTranslationCacheParams = {
  provider: string
  sourceLanguage: string
  targetLanguage: string
  sourceHash: string
}

export type TranslationCacheEntry = {
  content: string
  detectedSourceLanguage: string | null
}

export type SaveTranslationCacheParams = GetTranslationCacheParams &
  TranslationCacheEntry

export interface TranslationCacheDatabase {
  getTranslationCache(
    params: GetTranslationCacheParams
  ): Promise<TranslationCacheEntry | null>
  saveTranslationCache(params: SaveTranslationCacheParams): Promise<void>
}

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
  addListAccounts(params: AddListAccountsParams): Promise<void>
  removeListAccounts(params: RemoveListAccountsParams): Promise<void>
  getListsWithAccount(params: GetListsWithAccountParams): Promise<List[]>
  getListTimeline(params: GetListTimelineParams): Promise<Status[]>
  // Fan a newly created status into every list (in the `timelines` table) whose
  // membership includes the status author. Called from addStatusToTimelines.
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
export type SetCollectionMemberStateParams = {
  id: string
  actorId: string
  targetActorId: string
  state: CollectionFeatureState
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
export type GetCollectionsWithAccountParams = {
  actorId: string
  targetActorId: string
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
  limit?: number
  maxStatusId?: string | null
  minStatusId?: string | null
}
export type GetPublicCollectionTimelineParams = {
  id: string
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
  setCollectionMemberState(
    params: SetCollectionMemberStateParams
  ): Promise<void>
  // Member-facing approve/revoke of the caller's own membership. Returns true
  // when a membership row was updated, false when none matched.
  setOwnCollectionMembershipState(
    params: SetOwnCollectionMembershipStateParams
  ): Promise<boolean>
  getCollectionMembers(
    params: GetCollectionMembersParams
  ): Promise<CollectionMembersPage>
  getCollectionsWithAccount(
    params: GetCollectionsWithAccountParams
  ): Promise<Collection[]>
  // Approved members (id + actor type), oldest-first, owner-scoped. Used to
  // build the FEP-7aa9 FeaturedCollection ActivityPub representation, where each
  // FeaturedItem carries the member's actual `featuredObjectType`.
  getApprovedCollectionMembers(
    params: GetApprovedCollectionMembersParams
  ): Promise<ApprovedCollectionMember[]>
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

export type FollowedTag = {
  id: string
  actorId: string
  name: string
  createdAt: number
}
export type FollowTagParams = { actorId: string; name: string }
export type UnfollowTagParams = { actorId: string; name: string }
export type GetFollowedTagParams = { actorId: string; name: string }
export type GetFollowedTagsParams = {
  actorId: string
  limit?: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}
export type IsFollowingTagParams = { actorId: string; name: string }

export interface FollowedTagDatabase {
  followTag(params: FollowTagParams): Promise<FollowedTag>
  unfollowTag(params: UnfollowTagParams): Promise<FollowedTag | null>
  getFollowedTag(params: GetFollowedTagParams): Promise<FollowedTag | null>
  getFollowedTags(params: GetFollowedTagsParams): Promise<FollowedTag[]>
  isFollowingTag(params: IsFollowingTagParams): Promise<boolean>
}

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
export type GetFeaturedTagParams = { actorId: string; id: string }
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
  getFeaturedTag(
    params: GetFeaturedTagParams
  ): Promise<FeaturedTagWithStats | null>
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

// A status an actor has scheduled for future publication. `params` is the
// Mastodon "params" payload (text, visibility, media_ids, poll, …) stored as
// JSON text; `scheduledAt`/`createdAt`/`updatedAt` are epoch milliseconds in
// the domain shape regardless of the backend's timestamp storage.
export type ScheduledStatusData = {
  id: string
  actorId: string
  scheduledAt: number
  params: Mastodon.ScheduledStatusParams
  createdAt: number
  updatedAt: number
}

export type CreateScheduledStatusParams = {
  actorId: string
  scheduledAt: number
  params: Mastodon.ScheduledStatusParams
}
export type GetScheduledStatusesParams = {
  actorId: string
  limit: number
  maxId?: string
  minId?: string
  sinceId?: string
}
export type GetScheduledStatusParams = { actorId: string; id: string }
export type GetScheduledStatusByIdParams = { id: string }
export type UpdateScheduledStatusAtParams = {
  actorId: string
  id: string
  scheduledAt: number
}
export type DeleteScheduledStatusParams = { actorId: string; id: string }
export type GetDueScheduledStatusesParams = {
  before: number
  // Optional cap so a future cron poller can drain due rows in bounded batches
  // rather than loading every overdue scheduled status into memory at once.
  limit?: number
}

export interface ScheduledStatusDatabase {
  createScheduledStatus(
    params: CreateScheduledStatusParams
  ): Promise<ScheduledStatusData>
  // Owner-scoped list ordered by scheduledAt descending (id as a stable
  // tiebreaker) for Mastodon's scheduled_statuses cursor pagination — the
  // maxId/minId/sinceId cursors keyset on scheduledAt + id.
  getScheduledStatuses(
    params: GetScheduledStatusesParams
  ): Promise<ScheduledStatusData[]>
  getScheduledStatus(
    params: GetScheduledStatusParams
  ): Promise<ScheduledStatusData | null>
  // Owner-agnostic lookup by id, for the background publish job which only
  // carries the scheduled status id.
  getScheduledStatusById(
    params: GetScheduledStatusByIdParams
  ): Promise<ScheduledStatusData | null>
  // Reschedule; returns the updated row or null when not found/owned.
  updateScheduledStatusAt(
    params: UpdateScheduledStatusAtParams
  ): Promise<ScheduledStatusData | null>
  // Owner-scoped delete; true when a row was removed.
  deleteScheduledStatus(params: DeleteScheduledStatusParams): Promise<boolean>
  // Rows due for publication (scheduledAt <= before) across all actors, for the
  // background publish job.
  getDueScheduledStatuses(
    params: GetDueScheduledStatusesParams
  ): Promise<ScheduledStatusData[]>
}

// ============================================================================
// Instance Rule Database
// ============================================================================

// A moderation rule shown on the instance's about page and returned from
// GET /api/v1/instance/rules. `position` drives the display order (ascending,
// with `createdAt` as a stable tiebreaker); `hint` is the optional longer
// explanation Mastodon 4.3+ renders under the rule. `createdAt`/`updatedAt`
// are epoch milliseconds in the domain shape regardless of the backend's
// timestamp storage.
export type InstanceRuleData = {
  id: string
  position: number
  text: string
  hint: string
  createdAt: number
  updatedAt: number
}

export type CreateInstanceRuleParams = {
  text: string
  hint: string
  position?: number
}
export type UpdateInstanceRuleParams = {
  id: string
  text?: string
  hint?: string
  position?: number
}
export type DeleteInstanceRuleParams = { id: string }

export interface InstanceRuleDatabase {
  createInstanceRule(
    params: CreateInstanceRuleParams
  ): Promise<InstanceRuleData>
  // Partial update; bumps updatedAt and returns the updated row, or null when
  // the rule does not exist.
  updateInstanceRule(
    params: UpdateInstanceRuleParams
  ): Promise<InstanceRuleData | null>
  // True when a row was removed.
  deleteInstanceRule(params: DeleteInstanceRuleParams): Promise<boolean>
  // All rules ordered by position ascending, then createdAt ascending.
  getInstanceRules(): Promise<InstanceRuleData[]>
}

// ============================================================================
// Relay Database
// ============================================================================

// A subscription to an ActivityPub relay. See lib/types/domain/relay.ts for
// the field semantics. `createdAt`/`updatedAt` are epoch milliseconds in the
// domain shape regardless of the backend's timestamp storage.
export type RelayData = Relay

export type CreateRelayParams = { inboxUrl: string }
export type UpdateRelayParams = {
  id: string
  state?: RelayState
  actorId?: string | null
  followActivityId?: string | null
  lastError?: string | null
}
export type DeleteRelayParams = { id: string }
export type GetRelayByIdParams = { id: string }
export type GetRelayByInboxUrlParams = { inboxUrl: string }
export type GetRelayByActorIdParams = { actorId: string }
export type GetRelayByFollowActivityIdParams = { followActivityId: string }

export interface RelayDatabase {
  // Creates a relay row in the `idle` state. Throws on a duplicate inboxUrl.
  createRelay(params: CreateRelayParams): Promise<RelayData>
  // Partial update; bumps updatedAt and returns the updated row, or null when
  // the relay does not exist. Passing actorId/followActivityId/lastError as
  // null clears the column.
  updateRelay(params: UpdateRelayParams): Promise<RelayData | null>
  // True when a row was removed.
  deleteRelay(params: DeleteRelayParams): Promise<boolean>
  // All relays ordered by createdAt ascending.
  getRelays(): Promise<RelayData[]>
  getRelayById(params: GetRelayByIdParams): Promise<RelayData | null>
  getRelayByInboxUrl(
    params: GetRelayByInboxUrlParams
  ): Promise<RelayData | null>
  // Resolve a relay by its actor id (used to recognise an inbound
  // relay-forwarded activity's HTTP signer). Returns null when unknown.
  getRelayByActorId(params: GetRelayByActorIdParams): Promise<RelayData | null>
  // Resolve a relay by the Follow id we sent (used to match the relay's
  // Accept/Reject back to the subscription). Returns null when unknown.
  getRelayByFollowActivityId(
    params: GetRelayByFollowActivityIdParams
  ): Promise<RelayData | null>
  // Accepted relays only — the fan-out targets for local public posts.
  getAcceptedRelays(): Promise<RelayData[]>
}

// ============================================================================
// Suggestion Database
// ============================================================================

// A friends-of-friends follow suggestion candidate: an account followed by
// the accounts `actorId` follows. `mutuals` is the number of accepted
// follow edges from those followed accounts to the candidate, used for
// ranking (descending).
export type FriendsOfFriendsSuggestion = {
  targetActorId: string
  mutuals: number
}

export type GetFriendsOfFriendsSuggestionsParams = {
  actorId: string
  limit: number
}
export type DismissSuggestionParams = {
  actorId: string
  targetActorId: string
}

export interface SuggestionDatabase {
  // Accounts followed by the accounts `actorId` follows, ranked by mutual
  // count descending (targetActorId ascending as a stable tiebreaker).
  // Excludes `actorId` itself, anyone `actorId` already follows (Accepted) or
  // has a pending request to, anyone `actorId` has dismissed, anyone in a block
  // with `actorId` (either direction), and anyone `actorId` actively mutes.
  // Only Accepted follow edges count on both hops.
  getFriendsOfFriendsSuggestions(
    params: GetFriendsOfFriendsSuggestionsParams
  ): Promise<FriendsOfFriendsSuggestion[]>
  // Idempotent: dismissing an already-dismissed pair is a no-op.
  dismissSuggestion(params: DismissSuggestionParams): Promise<void>
}

// ============================================================================
// Announcement Database
// ============================================================================

// An instance-wide announcement (Mastodon's "announcement"). `text` is the raw
// source; the HTML `content` is rendered at serialization time. `published`
// gates visibility to actors and `publishedAt` records when it first went live.
// `allDay`/`startsAt`/`endsAt` describe an optional active window.
// `startsAt`/`endsAt`/`publishedAt` are epoch milliseconds (or null) in the
// domain shape regardless of the backend's timestamp storage; `createdAt` and
// `updatedAt` are always epoch milliseconds.
export type AnnouncementData = {
  id: string
  text: string
  published: boolean
  allDay: boolean
  startsAt: number | null
  endsAt: number | null
  publishedAt: number | null
  createdAt: number
  updatedAt: number
}

export type CreateAnnouncementParams = {
  text: string
  startsAt?: number | null
  endsAt?: number | null
  allDay?: boolean
  published?: boolean
}
export type UpdateAnnouncementParams = {
  id: string
  text?: string
  startsAt?: number | null
  endsAt?: number | null
  allDay?: boolean
  published?: boolean
}
export type DeleteAnnouncementParams = { id: string }
export type GetAnnouncementParams = { id: string }
export type GetActiveAnnouncementsParams = {
  // Epoch milliseconds used to evaluate the active window.
  now: number
}
export type MarkAnnouncementReadParams = {
  announcementId: string
  actorId: string
}
export type AnnouncementReactionParams = {
  announcementId: string
  actorId: string
  name: string
}
export type GetAnnouncementReadIdsParams = {
  actorId: string
  announcementIds: string[]
}
export type GetAnnouncementReactionsParams = {
  announcementIds: string[]
  actorId: string
}

// One (announcement, name) reaction rollup: `count` is the number of distinct
// actors who reacted with `name`, and `me` is whether the querying `actorId` is
// among them.
export type AnnouncementReactionRollup = {
  announcementId: string
  name: string
  count: number
  me: boolean
}

export interface AnnouncementDatabase {
  // Admin: create an announcement. Sets publishedAt to the creation time when
  // `published` is true, otherwise leaves it null.
  createAnnouncement(
    params: CreateAnnouncementParams
  ): Promise<AnnouncementData>
  // Admin: partial update; bumps updatedAt. When `published` transitions from
  // false to true and publishedAt is still null, sets publishedAt. Returns the
  // updated row, or null when the announcement does not exist.
  updateAnnouncement(
    params: UpdateAnnouncementParams
  ): Promise<AnnouncementData | null>
  // Admin: delete an announcement and clean up its reads and reactions.
  deleteAnnouncement(params: DeleteAnnouncementParams): Promise<void>
  // Admin: all announcements, newest first by createdAt.
  getAnnouncements(): Promise<AnnouncementData[]>
  // Get a single announcement by id, or null when it does not exist.
  getAnnouncement(
    params: GetAnnouncementParams
  ): Promise<AnnouncementData | null>
  // Public: published announcements whose optional active window contains `now`
  // (startsAt is null or <= now, and endsAt is null or >= now), newest first.
  getActiveAnnouncements(
    params: GetActiveAnnouncementsParams
  ): Promise<AnnouncementData[]>
  // Per-actor: idempotently record that the actor read the announcement.
  markAnnouncementRead(params: MarkAnnouncementReadParams): Promise<void>
  // Per-actor: idempotently add a reaction on the (announcement, actor, name)
  // composite key.
  addAnnouncementReaction(params: AnnouncementReactionParams): Promise<void>
  // Per-actor: remove a reaction.
  removeAnnouncementReaction(params: AnnouncementReactionParams): Promise<void>
  // Per-actor: which of `announcementIds` the actor has read.
  getAnnouncementReadIds(
    params: GetAnnouncementReadIdsParams
  ): Promise<string[]>
  // Reaction rollups grouped by (announcementId, name) for the given
  // announcements, with `me` flagged for the querying actor.
  getAnnouncementReactions(
    params: GetAnnouncementReactionsParams
  ): Promise<AnnouncementReactionRollup[]>
}

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

export const ReportCategory = z.enum(['spam', 'legal', 'violation', 'other'])
export type ReportCategory = z.infer<typeof ReportCategory>

export type Report = {
  id: string
  actorId: string
  targetActorId: string
  category: ReportCategory
  comment: string
  forward: boolean
  statusIds: string[]
  ruleIds: string[]
  collectionIds: string[]
  actionTaken: boolean
  createdAt: number
  updatedAt: number
}
export type CreateReportParams = {
  actorId: string
  targetActorId: string
  category?: ReportCategory
  comment?: string
  forward?: boolean
  statusIds?: string[]
  ruleIds?: string[]
  collectionIds?: string[]
}

export interface ReportDatabase {
  createReport(params: CreateReportParams): Promise<Report>
}

// ============================================================================
// Account Note Database
// ============================================================================

export type UpsertAccountNoteParams = {
  actorId: string
  targetActorId: string
  comment: string
}
export type GetAccountNoteParams = {
  actorId: string
  targetActorId: string
}

export interface AccountNoteDatabase {
  // Sets the private note for (actorId -> targetActorId). An empty comment
  // clears the note. Returns the stored comment (empty string when cleared).
  upsertAccountNote(params: UpsertAccountNoteParams): Promise<string>
  getAccountNote(params: GetAccountNoteParams): Promise<string>
}

// ============================================================================
// Endorsement Database
// ============================================================================

export type CreateEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type DeleteEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type GetEndorsementParams = {
  actorId: string
  targetActorId: string
}
export type GetEndorsementsParams = {
  actorId: string
  limit: number
  maxId?: string | null
  // min_id and since_id have distinct Mastodon semantics and are ordered
  // differently: min_id returns the oldest band immediately after the cursor,
  // since_id returns the newest band above the cursor.
  minId?: string | null
  sinceId?: string | null
}

export interface EndorsementDatabase {
  // Idempotently endorse (feature) targetActorId from actorId. Returns the
  // stored endorsement.
  createEndorsement(params: CreateEndorsementParams): Promise<Endorsement>
  // Removes the endorsement if present (no-op otherwise).
  deleteEndorsement(params: DeleteEndorsementParams): Promise<void>
  // Returns the endorsement for (actorId -> targetActorId), or null.
  getEndorsement(params: GetEndorsementParams): Promise<Endorsement | null>
  // Endorsements made BY actorId, newest first, paginated by numeric id cursor.
  getEndorsements(params: GetEndorsementsParams): Promise<Endorsement[]>
}

// ============================================================================
// Filter Database
// ============================================================================

export type CreateFilterKeywordInput = {
  keyword: string
  wholeWord?: boolean
}

export type UpdateFilterKeywordInput = {
  id?: string
  keyword?: string
  wholeWord?: boolean
  _destroy?: boolean
}

export type CreateFilterParams = {
  actorId: string
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  expiresAt: number | null
  keywords?: CreateFilterKeywordInput[]
}

export type GetFiltersParams = {
  actorId: string
}

export type GetFilterParams = {
  actorId: string
  id: string
}

export type UpdateFilterParams = {
  actorId: string
  id: string
  title?: string
  context?: FilterContext[]
  filterAction?: FilterAction
  expiresAt?: number | null
  keywords?: UpdateFilterKeywordInput[]
}

export type DeleteFilterParams = {
  actorId: string
  id: string
}

export type GetActiveFiltersForActorParams = {
  actorId: string
  context?: FilterContext
}

export type GetFilterRecordsForActorParams = {
  actorId: string
}

export type ActiveFilterRecord = {
  filter: Filter
  keywords: FilterKeyword[]
  statuses: FilterStatus[]
}

export type AddFilterKeywordParams = {
  actorId: string
  filterId: string
  keyword: string
  wholeWord?: boolean
}

export type GetFilterKeywordsParams = {
  actorId: string
  filterId: string
}

export type GetFilterKeywordParams = {
  actorId: string
  id: string
}

export type UpdateFilterKeywordParams = {
  actorId: string
  id: string
  keyword?: string
  wholeWord?: boolean
}

export type DeleteFilterKeywordParams = {
  actorId: string
  id: string
}

export type AddFilterStatusParams = {
  actorId: string
  filterId: string
  statusId: string
}

export type GetFilterStatusesParams = {
  actorId: string
  filterId: string
}

export type GetFilterStatusParams = {
  actorId: string
  id: string
}

export type DeleteFilterStatusParams = {
  actorId: string
  id: string
}

export interface FilterDatabase {
  createFilter(params: CreateFilterParams): Promise<Filter>
  getFilters(params: GetFiltersParams): Promise<Filter[]>
  getFilter(params: GetFilterParams): Promise<Filter | null>
  updateFilter(params: UpdateFilterParams): Promise<Filter | null>
  deleteFilter(params: DeleteFilterParams): Promise<Filter | null>
  getActiveFiltersForActor(
    params: GetActiveFiltersForActorParams
  ): Promise<ActiveFilterRecord[]>
  // Like getActiveFiltersForActor but returns ALL of the actor's filters,
  // including expired ones, so the management UI can list expired filters with
  // an "Expired" badge and let the user reactivate them.
  getFilterRecordsForActor(
    params: GetFilterRecordsForActorParams
  ): Promise<ActiveFilterRecord[]>
  addFilterKeyword(
    params: AddFilterKeywordParams
  ): Promise<FilterKeyword | null>
  getFilterKeywords(
    params: GetFilterKeywordsParams
  ): Promise<FilterKeyword[] | null>
  getFilterKeyword(
    params: GetFilterKeywordParams
  ): Promise<FilterKeyword | null>
  updateFilterKeyword(
    params: UpdateFilterKeywordParams
  ): Promise<FilterKeyword | null | 'duplicate'>
  deleteFilterKeyword(
    params: DeleteFilterKeywordParams
  ): Promise<FilterKeyword | null>
  addFilterStatus(params: AddFilterStatusParams): Promise<FilterStatus | null>
  getFilterStatuses(
    params: GetFilterStatusesParams
  ): Promise<FilterStatus[] | null>
  getFilterStatus(params: GetFilterStatusParams): Promise<FilterStatus | null>
  deleteFilterStatus(
    params: DeleteFilterStatusParams
  ): Promise<FilterStatus | null>
}

// ============================================================================
// Server Filter Database (instance-wide, admin-authored)
// ============================================================================

export type CreateServerFilterParams = {
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  expiresAt: number | null
  keywords?: CreateFilterKeywordInput[]
}

export type GetServerFilterParams = {
  id: string
}

export type UpdateServerFilterParams = {
  id: string
  title?: string
  context?: FilterContext[]
  filterAction?: FilterAction
  expiresAt?: number | null
  keywords?: UpdateFilterKeywordInput[]
}

export type DeleteServerFilterParams = {
  id: string
}

export type GetActiveServerFiltersParams = {
  context?: FilterContext
}

export type ActiveServerFilterRecord = {
  filter: ServerFilter
  keywords: FilterKeyword[]
}

export interface ServerFilterDatabase {
  createServerFilter(params: CreateServerFilterParams): Promise<ServerFilter>
  // All server filters (including expired), hydrated with keywords, for the
  // admin management UI.
  getServerFilterRecords(): Promise<ActiveServerFilterRecord[]>
  // A single server filter (including expired) hydrated with keywords, for the
  // admin detail endpoint.
  getServerFilterRecord(
    params: GetServerFilterParams
  ): Promise<ActiveServerFilterRecord | null>
  getServerFilter(params: GetServerFilterParams): Promise<ServerFilter | null>
  getServerFilterKeywords(
    params: GetServerFilterParams
  ): Promise<FilterKeyword[] | null>
  updateServerFilter(
    params: UpdateServerFilterParams
  ): Promise<ServerFilter | null>
  deleteServerFilter(
    params: DeleteServerFilterParams
  ): Promise<ServerFilter | null>
  // Only active (non-expired) server filters, hydrated with keywords, for
  // merging into clients' filter lists and applying to timelines.
  getActiveServerFilters(
    params?: GetActiveServerFiltersParams
  ): Promise<ActiveServerFilterRecord[]>
}

// ============================================================================
// Like Database
// ============================================================================

interface BaseLikeParams {
  actorId: string
  statusId: string
}
export type CreateLikeParams = BaseLikeParams
export type DeleteLikeParams = BaseLikeParams
export type GetLikeCountParams = Pick<BaseLikeParams, 'statusId'>
export type IsActorLikedStatusParams = BaseLikeParams

export interface Like {
  actorId: string
  statusId: string
  createdAt: number
}

export type GetLikesParams = {
  actorId: string
  limit: number
  // Opaque composite cursors produced by encodeFavouriteCursor; older = max_id,
  // newer = min_id/since_id. Invalid cursors yield an empty page.
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface LikeDatabase {
  createLike(params: CreateLikeParams): Promise<void>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>
  isActorLikedStatus(params: IsActorLikedStatusParams): Promise<boolean>
  getLikes(params: GetLikesParams): Promise<Like[]>
}

// ============================================================================
// Bookmark Database
// ============================================================================

interface BaseBookmarkParams {
  actorId: string
  statusId: string
}
export type CreateBookmarkParams = BaseBookmarkParams
export type DeleteBookmarkParams = BaseBookmarkParams
export type IsActorBookmarkedStatusParams = BaseBookmarkParams & {
  // Allows callers that already loaded the status to skip an extra lookup for non-Announce rows.
  statusType?: StatusType
}
export type GetBookmarksParams = {
  actorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
  sinceId?: string | null
}

export interface BookmarkDatabase {
  createBookmark(params: CreateBookmarkParams): Promise<void>
  deleteBookmark(params: DeleteBookmarkParams): Promise<void>
  isActorBookmarkedStatus(
    params: IsActorBookmarkedStatusParams
  ): Promise<boolean>
  getBookmarks(params: GetBookmarksParams): Promise<Bookmark[]>
}

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
}

// A processed thumbnail ready to persist on an existing media row. Mirrors the
// shape `createMedia` already accepts for `thumbnail`.
export type MediaThumbnailInput = {
  path: string
  bytes: number
  mimeType: string
  metaData: { width: number; height: number }
}

export interface Media extends BaseMedia {
  id: string
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
export type DeleteMediaByPathParams = {
  actorId: string
  path: string
}
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
  description?: string | null
  focus?: { x: number; y: number }
  thumbnail?: MediaThumbnailInput
}
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
}

export interface MediaDatabase {
  createMedia(params: CreateMediaParams): Promise<Media | null>
  markMediaUploadVerified(
    params: MarkMediaUploadVerifiedParams
  ): Promise<Media | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
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
  deleteMediaByPath(params: DeleteMediaByPathParams): Promise<boolean>
}

// ============================================================================
// Notification Database
// ============================================================================

export const NotificationType = z.enum([
  'follow_request',
  'follow',
  'like',
  'mention',
  'reply',
  'reblog',
  'activity_import',
  // Mastodon 4.6 Collections: a member was added to a collection
  // (`added_to_collection`) or a collection they're in had its metadata changed
  // (`collection_update`).
  'added_to_collection',
  'collection_update'
])

export type NotificationType = z.infer<typeof NotificationType>

export interface Notification {
  id: string
  actorId: string
  type: NotificationType
  sourceActorId: string
  statusId?: string
  followId?: string
  isRead: boolean
  readAt?: number
  groupKey?: string
  // When true, the recipient's notification policy routed this notification to
  // the per-sender requests queue instead of the main timeline.
  filtered: boolean
  createdAt: number
  updatedAt: number
}

export type CreateNotificationParams = {
  actorId: string
  type: NotificationType
  sourceActorId: string
  statusId?: string
  followId?: string
  groupKey?: string
  // Set true to route this notification to the per-sender requests queue
  // (computed by the notification policy). Defaults to false.
  filtered?: boolean
}

export type GetNotificationsParams = {
  actorId: string
  limit: number
  offset?: number
  // Restrict to notifications generated by this source actor (full actor
  // URL) — backs the Mastodon `account_id` query parameter.
  sourceActorId?: string
  types?: NotificationType[]
  excludeTypes?: NotificationType[]
  onlyUnread?: boolean
  ids?: string[]
  maxNotificationId?: string
  minNotificationId?: string
  sinceNotificationId?: string
  // When omitted/false, policy-filtered notifications (filtered = true) are
  // excluded. Pass true to include them (Mastodon `include_filtered`).
  includeFiltered?: boolean
}

export type GetNotificationsCountParams = {
  actorId: string
  onlyUnread?: boolean
  types?: NotificationType[]
  excludeTypes?: NotificationType[]
  // Cap the count at this many notifications (Mastodon `unread_count` caps at
  // 100 by default, max 1000). When omitted, counts all matching rows.
  limit?: number
  includeFiltered?: boolean
  // Count only policy-filtered notifications (overrides includeFiltered). Used
  // for the notification policy summary's pending_notifications_count.
  filteredOnly?: boolean
}

export type MarkNotificationsReadParams = {
  notificationIds: string[]
}

export type UpdateNotificationParams = {
  notificationId: string
  isRead?: boolean
  readAt?: number
}

// ============================================================================
// Push Subscription Database
// ============================================================================

// Mastodon WebPushSubscription alert flags. Keys mirror
// https://docs.joinmastodon.org/entities/WebPushSubscription/#alerts
export type PushAlerts = {
  mention: boolean
  status: boolean
  reblog: boolean
  follow: boolean
  follow_request: boolean
  favourite: boolean
  poll: boolean
  update: boolean
  quote: boolean
  quoted_update: boolean
  'admin.sign_up': boolean
  'admin.report': boolean
}

// Mastodon WebPushSubscription policy — who can generate notifications.
export type PushPolicy = 'all' | 'followed' | 'follower' | 'none'

export interface PushSubscription {
  id: string
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts: PushAlerts
  policy: PushPolicy
  standard: boolean
  // The plaintext OAuth access token tied to this subscription, when it was
  // created via a bearer token. Included in the Mastodon Web Push payload so
  // native clients can attribute the push and fetch the full notification.
  // Null for browser PushManager subscriptions (web-session auth, no token).
  accessToken?: string
  createdAt: number
  updatedAt: number
}

export type CreatePushSubscriptionParams = {
  actorId: string
  endpoint: string
  p256dh: string
  auth: string
  alerts?: Partial<PushAlerts>
  policy?: PushPolicy
  standard?: boolean
  accessToken?: string
}

export type UpdatePushSubscriptionParams = {
  actorId: string
  endpoint?: string
  alerts?: Partial<PushAlerts>
  policy?: PushPolicy
  // Scope the update to the subscription owned by this access token (per the
  // Mastodon spec, one subscription per token). Without it the update targets
  // the actor's most-recent tokenless (web-session) subscription.
  accessToken?: string
}

export type DeletePushSubscriptionParams = {
  endpoint: string
  actorId: string
}

export type GetPushSubscriptionsForActorParams = {
  actorId: string
}

export type GetPushSubscriptionForActorParams = {
  actorId: string
  // Return the subscription owned by this access token (per the Mastodon
  // spec, one subscription per token). Without it the lookup returns the
  // actor's most-recent tokenless (web-session) subscription.
  accessToken?: string
}

export interface PushSubscriptionDatabase {
  createPushSubscription(
    params: CreatePushSubscriptionParams
  ): Promise<PushSubscription>
  updatePushSubscription(
    params: UpdatePushSubscriptionParams
  ): Promise<PushSubscription | null>
  deletePushSubscription(params: DeletePushSubscriptionParams): Promise<void>
  getPushSubscriptionsForActor(
    params: GetPushSubscriptionsForActorParams
  ): Promise<PushSubscription[]>
  getPushSubscriptionForActor(
    params: GetPushSubscriptionForActorParams
  ): Promise<PushSubscription | null>
  deletePushSubscriptionsForActor(params: { actorId: string }): Promise<void>
}

// A grouped, per-source-actor view of policy-filtered notifications — the
// backing data for Mastodon's NotificationRequest entity.
export interface NotificationRequest {
  // The source actor id (full URL) the filtered notifications came from.
  sourceActorId: string
  notificationsCount: number
  // The most recent filtered notification from this source actor.
  lastNotification: Notification
  createdAt: number
  updatedAt: number
}

export type GetNotificationRequestsParams = {
  actorId: string
  limit: number
  offset?: number
  maxCursor?: { updatedAt: number; sourceActorId: string }
  sinceCursor?: { updatedAt: number; sourceActorId: string }
}

export type GetNotificationRequestParams = {
  actorId: string
  sourceActorId: string
}

export type ResolveNotificationRequestsParams = {
  actorId: string
  sourceActorIds: string[]
}

export type NotificationGroupKeyParams = {
  actorId: string
  // A shared groupKey, or (for ungrouped notifications) a notification id.
  groupKey: string
  includeFiltered?: boolean
}

export interface NotificationDatabase {
  createNotification(params: CreateNotificationParams): Promise<Notification>
  getNotifications(params: GetNotificationsParams): Promise<Notification[]>
  getNotificationsCount(params: GetNotificationsCountParams): Promise<number>
  markNotificationsRead(params: MarkNotificationsReadParams): Promise<void>
  updateNotification(params: UpdateNotificationParams): Promise<void>
  deleteNotification(notificationId: string): Promise<void>

  // Notification requests: grouped views over filtered = true notifications.
  getNotificationRequests(
    params: GetNotificationRequestsParams
  ): Promise<NotificationRequest[]>
  getNotificationRequest(
    params: GetNotificationRequestParams
  ): Promise<NotificationRequest | null>
  getNotificationRequestsCount(params: { actorId: string }): Promise<number>
  // Accept = clear the filtered flag so the notifications surface in the main
  // timeline. Dismiss = delete the filtered notifications.
  acceptNotificationRequests(
    params: ResolveNotificationRequestsParams
  ): Promise<void>
  dismissNotificationRequests(
    params: ResolveNotificationRequestsParams
  ): Promise<void>

  // Grouped notifications (v2): resolve and dismiss by group key (or, for
  // ungrouped notifications, by notification id).
  getNotificationsForGroupKey(
    params: NotificationGroupKeyParams
  ): Promise<Notification[]>
  dismissNotificationGroup(params: NotificationGroupKeyParams): Promise<void>
}

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
  // with specific granular scopes. Note: AdminApiGuard currently only accepts
  // the aggregate admin:read / admin:write (or coarse read / write) at the OAuth
  // bearer gate — a token granted only a granular admin:read:* scope is rejected
  // there today. Per-route granular admin scope enforcement is Tier 2 work.
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

export const GetClientFromNameParams = z.object({
  name: z.string()
})
export type GetClientFromNameParams = z.infer<typeof GetClientFromNameParams>

export const GetClientFromIdParams = z.object({
  clientId: z.string()
})
export type GetClientFromIdParams = z.infer<typeof GetClientFromIdParams>

export type GetAccountConnectedAppsParams = {
  accountId: string
}

export type RevokeAccountConnectedAppParams = {
  accountId: string
  clientId: string
  // The actor (consent referenceId) the grant belongs to. Null revokes the
  // account-scoped grant that has no actor reference.
  actorId: string | null
}

export interface OAuthDatabase {
  getClientFromName(params: GetClientFromNameParams): Promise<Client | null>
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
  getClientFromAccessToken(
    params: GetClientFromAccessTokenParams
  ): Promise<Client | null>
  createOAuthAccessToken(params: CreateOAuthAccessTokenParams): Promise<void>
  // List the third-party OAuth grants (API clients + SSO sign-ins) the account
  // has authorized, newest first.
  getAccountConnectedApps(
    params: GetAccountConnectedAppsParams
  ): Promise<ConnectedApp[]>
  // Revoke a connected app for the account: deletes the consent and every
  // access/refresh token issued for that client + actor.
  revokeAccountConnectedApp(
    params: RevokeAccountConnectedAppParams
  ): Promise<void>
}

export const GetClientFromAccessTokenParams = z.object({
  hashedToken: z.string()
})
export type GetClientFromAccessTokenParams = z.infer<
  typeof GetClientFromAccessTokenParams
>

export type CreateOAuthAccessTokenParams = {
  // SHA-256 base64url hash of the issued bearer token, matching how
  // OAuthGuard looks tokens up (GetClientFromAccessTokenParams.hashedToken).
  // Callers MUST pass the hash, never the raw token, so the raw token never
  // touches the database.
  hashedToken: string
  clientId: string
  // The owning account id (stored in `userId`).
  accountId: string
  // The actor delegated by the token (stored in `referenceId`); OAuthGuard
  // resolves the request actor from this column.
  actorId: string
  scopes: string[]
  // Epoch milliseconds.
  expiresAt: number
}

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

export interface InstanceActivityWeek {
  week: string
  statuses: string
  logins: string
  registrations: string
}

export interface GetInstanceActivityParams {
  now?: Date
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

export interface InstanceActivityDatabase {
  getInstanceActivity(
    params?: GetInstanceActivityParams
  ): Promise<InstanceActivityWeek[]>
  getInstancePeers(params?: GetInstancePeersParams): Promise<string[]>
  // Earliest-created local actor owned by an account with the admin role,
  // used as the Mastodon instance contact account; null when the instance
  // has no admin.
  getInstanceAdminActorId(): Promise<string | null>
}

export type GetInstancePeersParams = {
  localDomain: string
}

// ============================================================================
// Custom Emoji Database
// ============================================================================

export type CreateCustomEmojiParams = {
  shortcode: string
  url: string
  staticUrl: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}

export type GetCustomEmojisParams = {
  // When false (default) only enabled emoji are returned. The admin surface
  // passes `true` to also list disabled emoji.
  includeDisabled?: boolean
}

export type UpdateCustomEmojiParams = {
  id: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}

export interface CustomEmojiDatabase {
  createCustomEmoji(params: CreateCustomEmojiParams): Promise<CustomEmojiData>
  getCustomEmojis(params?: GetCustomEmojisParams): Promise<CustomEmojiData[]>
  getCustomEmojiById(id: string): Promise<CustomEmojiData | null>
  getCustomEmojiByShortcode(shortcode: string): Promise<CustomEmojiData | null>
  updateCustomEmoji(
    params: UpdateCustomEmojiParams
  ): Promise<CustomEmojiData | null>
  deleteCustomEmoji(id: string): Promise<CustomEmojiData | null>
}
