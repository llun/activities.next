// Database operation parameters and interfaces
// Consolidated from lib/database/types/*.ts
import { z } from 'zod'

import { Timeline } from '@/lib/services/timelines/types'
import { ActorSettings } from '@/lib/types/database/rows'
import { Account } from '@/lib/types/domain/account'
import { Actor } from '@/lib/types/domain/actor'
import { Attachment } from '@/lib/types/domain/attachment'
import { Follow, FollowStatus } from '@/lib/types/domain/follow'
import { Session } from '@/lib/types/domain/session'
import { Status } from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'
import * as Mastodon from '@/lib/types/mastodon'
// OAuth2 models - these are in lib/models/oauth2 and not being moved
import { AuthCode } from '@/lib/types/oauth2/authCode'
import { Client } from '@/lib/types/oauth2/client'
import { Token } from '@/lib/types/oauth2/token'

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
export type IsCurrentActorFollowingParams = {
  currentActorId: string
  followingActorId: string
}
export type UpdateActorParams = {
  actorId: string

  name?: string
  summary?: string
  iconUrl?: string
  headerImageUrl?: string
  manuallyApprovesFollowers?: boolean
  emailNotifications?: {
    follow_request?: boolean
    follow?: boolean
    like?: boolean
    mention?: boolean
    reply?: boolean
    reblog?: boolean
  }
  fitness?: {
    strava?: {
      clientId: string
      clientSecret: string
    }
  }

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
  getActorFromEmail(params: GetActorFromEmailParams): Promise<Actor | null>
  getActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Actor | null>
  getMastodonActorFromEmail(
    params: GetActorFromEmailParams
  ): Promise<Mastodon.Account | null>
  getMastodonActorFromUsername(
    params: GetActorFromUsernameParams
  ): Promise<Mastodon.Account | null>
  getMastodonActorFromId(
    params: GetActorFromIdParams
  ): Promise<Mastodon.Account | null>
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
}

// ============================================================================
// Account Database
// ============================================================================

export type IsAccountExistsParams = { email: string }
export type IsUsernameExistsParams = { username: string; domain: string }
export type CreateAccountParams = {
  email: string
  username: string
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
export type ChangePasswordParams = {
  accountId: string
  newPasswordHash: string
}

export interface AccountDatabase {
  isAccountExists(params: IsAccountExistsParams): Promise<boolean>
  isUsernameExists(params: IsUsernameExistsParams): Promise<boolean>

  createAccount(params: CreateAccountParams): Promise<string>
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
  changePassword(params: ChangePasswordParams): Promise<void>
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

  createdAt?: number
}

export type CreateNoteParams = BaseCreateStatusParams

type BaseStatusParams = {
  statusId: string
}

export type UpdateNoteParams = Pick<CreateNoteParams, 'text' | 'summary'> &
  BaseStatusParams

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
}
export type UpdatePollParams = Pick<CreatePollParams, 'text' | 'summary'> &
  BaseStatusParams & {
    choices: { title: string; totalVotes: number }[]
  }

export type GetStatusParams = BaseStatusParams & {
  currentActorId?: string
  withReplies?: boolean
}
export type GetStatusRepliesParams = BaseStatusParams & {
  url?: string
}
export type DeleteStatusParams = BaseStatusParams

export type GetStatusFromUrlParams = {
  url: string
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
}

export type GetActorStatusesCountParams = { actorId: string }
export type GetActorStatusesParams = {
  actorId: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
}
export type GetStatusesByIdsParams = {
  statusIds: string[]
  currentActorId?: string
  withReplies?: boolean
}

export type HasActorAnnouncedStatusParams = BaseStatusParams & {
  actorId?: string
}
export type GetFavouritedByParams = BaseStatusParams & {
  limit?: number
  offset?: number
}

export type CreateTagParams = {
  statusId: string
  name: string
  type: TagType
  value?: string
}
export type GetTagsParams = {
  statusId: string
}
export type GetStatusReblogsCountParams = {
  statusId: string
}
export type GetStatusRepliesCountParams = {
  statusId: string
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
export type IncrementPollChoiceVotesParams = {
  statusId: string
  choiceIndex: number
}

export interface StatusDatabase {
  createNote(params: CreateNoteParams): Promise<Status>
  createAnnounce(params: CreateAnnounceParams): Promise<Status>
  createPoll(params: CreatePollParams): Promise<Status>
  updateNote(params: UpdateNoteParams): Promise<Status | null>
  updatePoll(params: UpdatePollParams): Promise<Status | null>
  getStatus(params: GetStatusParams): Promise<Status | null>
  getStatusReplies(params: GetStatusRepliesParams): Promise<Status[]>
  getStatusFromUrl(params: GetStatusFromUrlParams): Promise<Status | null>
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
  getStatusesByIds(params: GetStatusesByIdsParams): Promise<Status[]>
  getFavouritedBy(params: GetFavouritedByParams): Promise<Actor[]>
  createTag(params: CreateTagParams): Promise<Tag>
  getTags(params: GetTagsParams): Promise<Tag[]>
  getStatusReblogsCount(params: GetStatusReblogsCountParams): Promise<number>
  getStatusRepliesCount(params: GetStatusRepliesCountParams): Promise<number>
  createPollAnswer(params: CreatePollAnswerParams): Promise<void>
  hasActorVoted(params: HasActorVotedParams): Promise<boolean>
  getActorPollVotes(params: GetActorPollVotesParams): Promise<number[]>
  incrementPollChoiceVotes(
    params: IncrementPollChoiceVotesParams
  ): Promise<void>
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
  minId?: string | null
}
export type GetFollowersParams = {
  targetActorId: string
  limit: number
  maxId?: string | null
  minId?: string | null
}
export type GetFollowRequestsParams = {
  targetActorId: string
  limit: number
  offset?: number
}
export type GetFollowRequestsCountParams = {
  targetActorId: string
}

export interface FollowDatabase {
  createFollow(params: CreateFollowParams): Promise<Follow>
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

export interface LikeDatabase {
  createLike(params: CreateLikeParams): Promise<void>
  deleteLike(params: DeleteLikeParams): Promise<void>
  getLikeCount(params: GetLikeCountParams): Promise<number>
  isActorLikedStatus(params: IsActorLikedStatusParams): Promise<boolean>
}

// ============================================================================
// Media Database
// ============================================================================

interface MetaData {
  width: number
  height: number
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
}
export type GetAttachmentsParams = {
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
export type GetMediaByIdParams = {
  mediaId: string
  accountId: string
}

export interface MediaDatabase {
  createMedia(params: CreateMediaParams): Promise<Media | null>

  createAttachment(params: CreateAttachmentParams): Promise<Attachment>
  getAttachments(params: GetAttachmentsParams): Promise<Attachment[]>
  getAttachmentsForActor(
    params: GetAttachmentsForActorParams
  ): Promise<Attachment[]>
  getMediasWithStatusForAccount(
    params: GetMediasForAccountParams
  ): Promise<PaginatedMediaWithStatus>
  getMediaByIdForAccount(params: GetMediaByIdParams): Promise<Media | null>
  getStorageUsageForAccount(
    params: GetStorageUsageForAccountParams
  ): Promise<number>
  deleteMedia(params: DeleteMediaParams): Promise<boolean>
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
  'reblog'
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
}

export type GetNotificationsParams = {
  actorId: string
  limit: number
  offset?: number
  types?: NotificationType[]
  excludeTypes?: NotificationType[]
  onlyUnread?: boolean
  ids?: string[]
  maxNotificationId?: string
  minNotificationId?: string
  sinceNotificationId?: string
}

export type GetNotificationsCountParams = {
  actorId: string
  onlyUnread?: boolean
  types?: NotificationType[]
}

export type MarkNotificationsReadParams = {
  notificationIds: string[]
}

export type UpdateNotificationParams = {
  notificationId: string
  isRead?: boolean
  readAt?: number
}

export interface NotificationDatabase {
  createNotification(params: CreateNotificationParams): Promise<Notification>
  getNotifications(params: GetNotificationsParams): Promise<Notification[]>
  getNotificationsCount(params: GetNotificationsCountParams): Promise<number>
  markNotificationsRead(params: MarkNotificationsReadParams): Promise<void>
  updateNotification(params: UpdateNotificationParams): Promise<void>
  deleteNotification(notificationId: string): Promise<void>
}

// ============================================================================
// OAuth Database
// ============================================================================

export const Scope = z.enum(['read', 'write', 'follow', 'push'])
export type Scope = z.infer<typeof Scope>

export const UsableScopes = [
  Scope.enum.read,
  Scope.enum.write,
  Scope.enum.follow
]

export const GrantIdentifiers = z.enum([
  'authorization_code',
  'client_credentials',
  'refresh_token',
  'password',
  'implicit'
])
export type GrantIdentifiers = z.infer<typeof GrantIdentifiers>

export const CreateClientParams = z.object({
  name: z.string(),
  redirectUris: z.string().array(),
  secret: z.string(),
  scopes: Scope.array(),
  website: z.string().optional()
})
export type CreateClientParams = z.infer<typeof CreateClientParams>

export const GetClientFromNameParams = z.object({
  name: z.string()
})
export type GetClientFromNameParams = z.infer<typeof GetClientFromNameParams>

export const GetClientFromIdParams = z.object({
  clientId: z.string()
})
export type GetClientFromIdParams = z.infer<typeof GetClientFromIdParams>

export const UpdateClientParams = CreateClientParams.extend({
  id: z.string()
})
export type UpdateClientParams = z.infer<typeof UpdateClientParams>

export const GetAccessTokenParams = z.object({
  accessToken: z.string()
})
export type GetAccessTokenParams = z.infer<typeof GetAccessTokenParams>

export const GetAccessTokenByRefreshTokenParams = z.object({
  refreshToken: z.string()
})
export type GetAccessTokenByRefreshTokenParams = z.infer<
  typeof GetAccessTokenByRefreshTokenParams
>

export const CreateAccessTokenParams = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),

  refreshToken: z.string().nullish(),
  refreshTokenExpiresAt: z.number().nullish(),

  clientId: z.string(),
  scopes: Scope.array(),

  actorId: z.string().nullish(),
  accountId: z.string().nullish()
})
export type CreateAccessTokenParams = z.infer<typeof CreateAccessTokenParams>

export const UpdateRefreshTokenParams = z.object({
  accessToken: z.string(),

  refreshToken: z.string(),
  refreshTokenExpiresAt: z.number().nullish()
})
export type UpdateRefreshTokenParams = z.infer<typeof UpdateRefreshTokenParams>

export const RevokeAccessTokenParams = z.object({ accessToken: z.string() })
export type RevokeAccessTokenParams = z.infer<typeof RevokeAccessTokenParams>

export const TouchAccessTokenParams = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.number(),
  refreshTokenExpiresAt: z.number().nullish()
})
export type TouchAccessTokenParams = z.infer<typeof TouchAccessTokenParams>

export const CreateAuthCodeParams = z.object({
  code: z.string(),
  redirectUri: z.string().nullish(),
  codeChallenge: z.string().nullish(),
  codeChallengeMethod: z.string().nullish(),

  actorId: z.string(),
  accountId: z.string(),
  clientId: z.string(),
  scopes: Scope.array(),

  expiresAt: z.number()
})
export type CreateAuthCodeParams = z.infer<typeof CreateAuthCodeParams>

export const GetAuthCodeParams = z.object({ code: z.string() })
export type GetAuthCodeParams = z.infer<typeof GetAuthCodeParams>

export const RevokeAuthCodeParams = z.object({ code: z.string() })
export type RevokeAuthCodeParams = z.infer<typeof RevokeAuthCodeParams>

export interface OAuthDatabase {
  createClient(params: CreateClientParams): Promise<Client | null>
  getClientFromName(params: GetClientFromNameParams): Promise<Client | null>
  getClientFromId(params: GetClientFromIdParams): Promise<Client | null>
  updateClient(params: UpdateClientParams): Promise<Client | null>

  getAccessToken(params: GetAccessTokenParams): Promise<Token | null>
  getAccessTokenByRefreshToken(
    params: GetAccessTokenByRefreshTokenParams
  ): Promise<Token | null>
  createAccessToken(params: CreateAccessTokenParams): Promise<Token | null>
  updateRefreshToken(params: UpdateRefreshTokenParams): Promise<Token | null>
  revokeAccessToken(params: RevokeAccessTokenParams): Promise<Token | null>
  touchAccessToken(params: TouchAccessTokenParams): Promise<void>

  createAuthCode(params: CreateAuthCodeParams): Promise<AuthCode | null>
  getAuthCode(params: GetAuthCodeParams): Promise<AuthCode | null>
  revokeAuthCode(params: RevokeAuthCodeParams): Promise<AuthCode | null>
}

// ============================================================================
// Timeline Database
// ============================================================================

export type GetTimelineParams = {
  timeline: Timeline
  actorId?: string
  minStatusId?: string | null
  maxStatusId?: string | null
  limit?: number
}
export type CreateTimelineStatusParams = {
  timeline: Timeline
  actorId: string
  status: Status
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
}
