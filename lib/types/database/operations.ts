import { z } from 'zod'

import type { CreateQueueJobParams } from '@/lib/database/domains/queueJob/types'
import type { StatusLookupDatabase } from '@/lib/database/domains/status/types'
import {
  Attachment,
  AttachmentMediaMetadata,
  PostBoxAttachment
} from '@/lib/types/domain/attachment'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import { Tag, TagType } from '@/lib/types/domain/tag'

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

export type {
  ActorDatabase,
  CancelActorDeletionParams,
  CreateActorParams,
  DeleteActorDataParams,
  DeleteActorParams,
  GetActorDeletionStatusParams,
  GetActorFollowersCountParams,
  GetActorFollowingCountParams,
  GetActorFromEmailParams,
  GetActorFromIdParams,
  GetActorFromUsernameParams,
  GetActorIdByPublicIdParams,
  GetActorIdsByPublicIdsParams,
  GetActorPublicIdsParams,
  GetActorSettingsParams,
  GetActorsFromIdsParams,
  GetActorsScheduledForDeletionParams,
  GetLocalActorsParams,
  HasActorCountersParams,
  IsCurrentActorFollowingParams,
  ScheduleActorDeletionParams,
  SetActorCountersParams,
  StartActorDeletionParams,
  UpdateActorParams
} from '@/lib/database/domains/actor/types'

// ============================================================================
// Account Database
// ============================================================================

export type {
  AccountDatabase,
  ChangePasswordParams,
  CreateAccountParams,
  CreateAccountSessionParams,
  CreateActorForAccountParams,
  DeleteAccountSessionByIdParams,
  DeleteOtherAccountSessionsParams,
  GetAccountAllSessionsParams,
  GetAccountFromEmailParams,
  GetAccountFromIdParams,
  GetActorsForAccountParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  RepointUnconfirmedAccountEmailParams,
  RequestEmailChangeParams,
  RequestPasswordResetParams,
  ResetPasswordWithCodeParams,
  SetDefaultActorParams,
  UnlinkAccountFromProviderParams,
  UpdateAccountImageParams,
  UpdateAccountNameParams,
  ValidatePasswordResetCodeParams,
  VerifyAccountParams,
  VerifyEmailChangeParams
} from '@/lib/database/domains/account/types'

// ============================================================================
// Status Database
// ============================================================================

export type {
  FavouritedByAccount,
  GetActorAnnouncedStatusIdParams,
  GetActorPollVotesForStatusesParams,
  GetActorPollVotesParams,
  GetActorStatusFromPathSegmentParams,
  GetFavouritedByParams,
  GetHashtagCounterParams,
  GetHashtagStatusesPageParams,
  GetHashtagStatusesPageResult,
  GetPinnedStatusIdsParams,
  GetRebloggedByParams,
  GetStatusFromPublicIdParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusIdByPublicIdParams,
  GetStatusIdsByPublicIdsParams,
  GetStatusPublicIdsParams,
  GetStatusesByHashtagParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  HasActorVotedParams,
  PinStatusParams,
  RebloggedByAccount,
  StatusLookupDatabase
} from '@/lib/database/domains/status/types'

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
export type GetStatusesByIdsParams = {
  statusIds: string[]
  currentActorId?: string
  visibleToActorId?: string | null
  withReplies?: boolean
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
export type DeleteStatusTagsByTypeParams = {
  statusId: string
  type: TagType
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

// The lookups, the poll reads, the hashtag reads, the pins and the
// favourited-by and reblogged-by pages run on Kysely (StatusLookupDatabase,
// lib/database/domains/status/); the methods below are still the Knex mixin
// in lib/database/sql/status.ts.
export interface StatusDatabase extends StatusLookupDatabase {
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
  deleteStatus(params: DeleteStatusParams): Promise<void>
  deleteStatusWithQueueJob(
    params: DeleteStatusWithQueueJobParams
  ): Promise<boolean>
  getActorStatusesCount(params: GetActorStatusesCountParams): Promise<number>
  getActorStatuses(params: GetActorStatusesParams): Promise<Status[]>
  getStatusesByIds(params: GetStatusesByIdsParams): Promise<Status[]>
  createTag(params: CreateTagParams): Promise<Tag>
  deleteStatusTagsByType(params: DeleteStatusTagsByTypeParams): Promise<void>
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

export { SearchDocumentEntityType } from '@/lib/database/domains/search/types'
export type {
  DeleteSearchDocumentParams,
  ReindexSearchDocumentsParams,
  ReindexSearchDocumentsResult,
  SearchAccountsParams,
  SearchDatabase,
  SearchDocument,
  SearchDocumentsParams,
  SearchHashtag,
  SearchHashtagsParams,
  SearchStatusesParams,
  UpsertSearchDocumentParams
} from '@/lib/database/domains/search/types'

// ============================================================================
// Direct Conversation Database
// ============================================================================

export type {
  DirectConversation,
  DirectConversationDatabase,
  GetDirectConversationParams,
  GetDirectConversationStatusesParams,
  GetDirectConversationsParams,
  HideDirectConversationParams,
  MarkDirectConversationReadParams,
  SyncDirectConversationForStatusParams
} from '@/lib/database/domains/conversation/types'

// ============================================================================
// Follow Database
// ============================================================================

export type {
  CreateFollowParams,
  FollowDatabase,
  GetAcceptedFollowTargetActorIdsParams,
  GetAcceptedOrRequestedFollowParams,
  GetAcceptedOrRequestedFollowsWithDomainParams,
  GetFollowersInboxParams,
  GetFollowersParams,
  GetFollowFromIdParams,
  GetFollowingParams,
  GetFollowRequestsCountParams,
  GetFollowRequestsParams,
  GetLocalActorsFromFollowerUrlParams,
  GetLocalFollowersForActorIdParams,
  GetLocalFollowsFromInboxUrlParams,
  UpdateFollowPreferencesParams,
  UpdateFollowStatusParams
} from '@/lib/database/domains/follow/types'

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

export type {
  AddListAccountsParams,
  AddListAccountsResult,
  AddStatusToListTimelinesParams,
  CreateListParams,
  DeleteListParams,
  GetListAccountCountsParams,
  GetListAccountsParams,
  GetListParams,
  GetListsParams,
  GetListsWithAccountParams,
  GetListTimelineParams,
  ListAccountsPage,
  ListDatabase,
  RemoveListAccountsParams,
  UpdateListParams
} from '@/lib/database/domains/list/types'

// ============================================================================
// Collection Database
// ============================================================================

export type {
  AddCollectionMembersParams,
  AddStatusToCollectionTimelinesParams,
  ApprovedCollectionMember,
  CollectionDatabase,
  CollectionItemRow,
  CollectionMembersPage,
  CountCollectionItemsParams,
  CreateCollectionParams,
  DeleteCollectionParams,
  GetAccountCollectionsParams,
  GetApprovedCollectionMembersParams,
  GetCollectionByIdParams,
  GetCollectionItemByAccountParams,
  GetCollectionItemParams,
  GetCollectionItemsParams,
  GetCollectionMemberCountsParams,
  GetCollectionMembersParams,
  GetCollectionParams,
  GetCollectionsFeaturingAccountParams,
  GetCollectionsParams,
  GetCollectionTimelineParams,
  GetPublicCollectionTimelineParams,
  RemoveCollectionItemByIdParams,
  RemoveCollectionMembersParams,
  SetOwnCollectionMembershipStateParams,
  UpdateCollectionParams
} from '@/lib/database/domains/collection/types'

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

export type {
  CountFeaturedTagsParams,
  CreateFeaturedTagParams,
  DeleteFeaturedTagParams,
  FeaturedTag,
  FeaturedTagDatabase,
  FeaturedTagSuggestion,
  FeaturedTagWithStats,
  GetFeaturedTagByNameParams,
  GetFeaturedTagSuggestionsParams,
  GetFeaturedTagsParams
} from '@/lib/database/domains/featuredTag/types'

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

export type {
  GetTagDailyHistoryParams,
  GetTrendingStatusCandidateIdsParams,
  GetTrendingTagsParams,
  TagDailyHistoryPoint,
  TrendingTag,
  TrendsDatabase
} from '@/lib/database/domains/trends/types'

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

export { ModerationActionType } from '@/lib/database/domains/moderation/types'
export type {
  AdminAccountDatabase,
  AdminAccountIp,
  AdminAccountRecord,
  ApproveAccountParams,
  CreateModerationActionParams,
  DeleteAllAccountSessionsParams,
  GetAdminAccountParams,
  GetAdminAccountRecordsParams,
  GetAdminAccountsParams,
  GetModerationStatesForActorsParams,
  GetSessionIpsForAccountsParams,
  ModerationAction,
  ModerationDatabase,
  ModerationStates,
  RejectPendingAccountParams,
  SetAccountDisabledParams,
  SetActorSensitizedParams,
  SetActorSilencedParams,
  SetActorSuspendedParams,
  SetReportResolutionParams
} from '@/lib/database/domains/moderation/types'

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

export type {
  AttachmentWithMedia,
  CreateAttachmentParams,
  CreateMediaParams,
  DeleteAttachmentsByIdsParams,
  DeleteMediaForAccountParams,
  DeleteMediaForAccountResult,
  DeleteMediaParams,
  DeleteMediaWithFilesResult,
  GetAttachmentsForActorParams,
  GetAttachmentsParams,
  GetAttachmentsWithMediaParams,
  GetMediaByIdParams,
  GetMediaByIdsForAccountParams,
  GetMediaWithAttachedStatusIdsParams,
  GetMediasForAccountParams,
  GetStorageUsageForAccountParams,
  MarkMediaUploadVerifiedParams,
  MarkMediaUploadVerifiedResult,
  Media,
  MediaDatabase,
  MediaThumbnailInput,
  MediaWithAttachedStatusIds,
  MediaWithStatus,
  PaginatedMediaWithStatus,
  ReplaceRemoteAttachmentsForStatusParams,
  SetMediaPlaceLookupParams,
  SetMediaSubjectLookupParams,
  SetMediaSubjectSuggestionsParams,
  UpdateAttachmentPlaybackParams,
  UpdateMediaDetailsParams,
  UpdateMediaParams,
  UpdateMediaResult
} from '@/lib/database/domains/media/types'

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

export type {
  AddStatusToFederatedTimelineParams,
  CreateTimelineStatusParams,
  GetTimelineParams,
  TimelineDatabase
} from '@/lib/database/domains/timeline/types'

// ============================================================================
// Admin Database
// ============================================================================

export {
  ALL_COUNTER_TYPES,
  DomainBlockSeverity,
  DomainFederationRuleType,
  MAX_STATS_WINDOW_MS
} from '@/lib/database/domains/admin/types'
export type {
  AdminDatabase,
  AdminHashtag,
  CreateDomainAllowParams,
  CreateDomainBlockParams,
  DomainAllow,
  DomainBlock,
  DomainFederationRule,
  DomainFederationRuleStats,
  GetAccountWithActorsParams,
  GetAccountWithActorsResult,
  GetAllAccountsParams,
  GetAllAccountsResult,
  GetAllHashtagsParams,
  GetAllHashtagsResult,
  GetDomainAllowsParams,
  GetDomainBlocksParams,
  GetServiceStatsBucketsParams,
  HashtagSortOrder,
  ImportDomainBlockParams,
  ImportDomainBlocksParams,
  ImportDomainBlocksResult,
  ServiceStatCounterType,
  ServiceStats,
  ServiceStatsBucket,
  UpdateDomainBlockParams
} from '@/lib/database/domains/admin/types'

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
