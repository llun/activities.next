import { z } from 'zod'

import type {
  StatusDeletionDatabase,
  StatusLookupDatabase,
  StatusReadDatabase,
  StatusWriteDatabase
} from '@/lib/database/domains/status/types'

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
  AccountPasskey,
  ChangePasswordParams,
  CreateAccountParams,
  CreateAccountSessionParams,
  CreateActorForAccountParams,
  DeleteAccountSessionByIdParams,
  DeleteOtherAccountSessionsParams,
  GetAccountAllSessionsParams,
  GetAccountFromEmailParams,
  GetAccountFromIdParams,
  GetAccountPasskeysParams,
  GetActorsForAccountParams,
  IsAccountExistsParams,
  IsUsernameExistsParams,
  LinkAccountWithProviderParams,
  RepointUnconfirmedAccountEmailParams,
  RequestEmailChangeParams,
  RequestPasswordResetParams,
  ResetPasswordWithCodeParams,
  SetDefaultActorParams,
  SetSessionActorIdByTokenParams,
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
  CreateAnnounceParams,
  CreateNoteParams,
  CreatePollAnswerParams,
  CreatePollParams,
  CreateStatusResult,
  CreateTagParams,
  DecreaseHashtagCounterParams,
  DeleteStatusParams,
  DeleteStatusTagsByTypeParams,
  DeleteStatusWithQueueJobParams,
  DiscardUnpublishedStatusParams,
  FavouritedByAccount,
  GetActorAnnouncedStatusIdParams,
  GetActorPollVotesForStatusesParams,
  GetActorPollVotesParams,
  GetActorStatusFromPathSegmentParams,
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetFavouritedByParams,
  GetHashtagCounterParams,
  GetHashtagStatusesPageParams,
  GetHashtagStatusesPageResult,
  GetPinnedStatusIdsParams,
  GetRebloggedByParams,
  GetStatusCountsParams,
  GetStatusEditHistoryParams,
  GetStatusFromPublicIdParams,
  GetStatusFromUrlHashParams,
  GetStatusFromUrlParams,
  GetStatusIdByPublicIdParams,
  GetStatusIdsByPublicIdsParams,
  GetStatusParams,
  GetStatusPublicIdsParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesCountParams,
  GetStatusRepliesParams,
  GetStatusesByHashtagParams,
  GetStatusesByIdsParams,
  GetTagsParams,
  HasActorAnnouncedStatusParams,
  HasActorVotedParams,
  IncreaseHashtagCounterParams,
  IncrementPollChoiceVotesParams,
  PinStatusParams,
  RebloggedByAccount,
  RecordPollVotesParams,
  StatusDeletionDatabase,
  StatusEditRevision,
  StatusLookupDatabase,
  StatusReadDatabase,
  StatusWriteDatabase,
  UpdateNoteAttachment,
  UpdateNoteParams,
  UpdateNoteVisibilityParams,
  UpdatePollParams,
  UpdateStatusQuoteApprovalPolicyParams
} from '@/lib/database/domains/status/types'

// The status domain runs on Kysely, in lib/database/domains/status/: the
// lookups, the poll reads, the hashtag reads, the pins, the favourited-by and
// reblogged-by pages (StatusLookupDatabase), the writes (StatusWriteDatabase),
// the reads and hydration (StatusReadDatabase) and the deletions
// (StatusDeletionDatabase).
export interface StatusDatabase
  extends
    StatusLookupDatabase,
    StatusWriteDatabase,
    StatusReadDatabase,
    StatusDeletionDatabase {}

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

export {
  IDEMPOTENCY_KEY_TTL_MS,
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
export type {
  DeleteExpiredIdempotencyKeysParams,
  GetIdempotentStatusIdParams,
  IdempotencyDatabase,
  IdempotencyKeyRecord,
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
// Served Domain Database
// ============================================================================

export type {
  CountLocalActorsByDomainParams,
  CreateServedDomainParams,
  DeleteServedDomainParams,
  DomainCheckItem,
  DomainCheckItemStatus,
  DomainCheckResult,
  GetServedDomainParams,
  ServedDomainData,
  ServedDomainDatabase,
  ServedDomainPolicies,
  ServedDomainStatus,
  ServedDomainWithPoliciesData,
  UpdateServedDomainParams
} from '@/lib/database/domains/servedDomain/types'

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
  CountRecentAppRegistrationsParams,
  CreateOAuthAccessTokenParams,
  CreateOAuthClientRegistrationParams,
  ExtendOAuthAccessTokenParams,
  GetAccountConnectedAppsParams,
  GetOAuthAccessTokenByHashParams,
  IsOAuthClientPKCERequiredParams,
  OAuthAccessTokenRecord,
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
