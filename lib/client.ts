import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import type { AdminAccount } from '@/lib/types/mastodon/admin/account'
import type { AdminReport } from '@/lib/types/mastodon/admin/report'
import type { Announcement } from '@/lib/types/mastodon/announcement'
import type { CollectionEntity } from '@/lib/types/mastodon/collection'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import type { Filter as MastodonFilter } from '@/lib/types/mastodon/filter'
import type { ListEntity } from '@/lib/types/mastodon/list'
import { MastodonVisibility } from '@/lib/utils/getVisibility'

import {
  type ActorDomainsResult,
  type CancelActorDeletionParams,
  type CancelActorDeletionResult,
  type CreateActorParams,
  type CreateActorResult,
  type CreateReportParams,
  type DeleteAccountMediaParams,
  type DeleteActorParams,
  type DeleteActorResult,
  type DeleteSessionParams,
  type FollowParams,
  type FollowRequestParams,
  type FollowStatusType,
  type GetActorDomainsParams,
  type GetActorStatusesParams,
  type GetActorStatusesResult,
  type GetBlocksParams,
  type GetBlocksResult,
  type GetMutesParams,
  type GetMutesResult,
  type MuteParams,
  type ReportCategory,
  type RevokeConnectedAppParams,
  type SetDefaultActorParams,
  type SetDefaultActorResult,
  type SwitchActorParams,
  acceptFollowRequest,
  block,
  cancelActorDeletion,
  createActor,
  createReport,
  deleteAccountMedia,
  deleteActor,
  deleteSession,
  follow,
  getActorDomains,
  getActorStatuses,
  getBlocks,
  getFollowStatus,
  getMutes,
  getRelationship,
  isFollowing,
  mute,
  rejectFollowRequest,
  revokeConnectedApp,
  revokeOtherSessions,
  setDefaultActor,
  switchActor,
  unblock,
  unfollow,
  unmute
} from './client/accounts'
import {
  type FitnessProcessingState,
  type StatusFitnessFileItem,
  getAppleMapsToken,
  getFitnessFilesByStatus,
  getFitnessImportBatch,
  getFitnessProcessingState,
  retryFitnessImportBatch
} from './client/fitnessFiles'
import {
  type FitnessGeneralSettingsResponse,
  type FitnessPrivacyLocationInput,
  type RegenerateFitnessMapsResponse,
  getFitnessGeneralSettings,
  regenerateFitnessMaps,
  updateFitnessGeneralSettings
} from './client/fitnessGeneralSettings'
import {
  type ActiveStravaArchiveImport,
  type ActiveStravaArchiveImportResponse,
  type FitnessImportBatchFile,
  type FitnessImportBatchResult,
  type StartFitnessImportResult,
  type StartStravaArchiveImportResult,
  type StravaArchivePresignedResult,
  type UploadFitnessFileResult,
  cancelStravaArchiveImport,
  createStravaArchivePresignedUrl,
  getActiveStravaArchiveImport,
  retryStravaArchiveImport,
  startFitnessImport,
  startStravaArchiveImport,
  uploadFitnessFile
} from './client/fitnessImports'
import {
  type FitnessActivitySummary,
  type FitnessRouteDataResponse,
  type FitnessRouteSample,
  type FitnessRouteSegment,
  type GetFitnessSummaryParams,
  deleteFitnessFile,
  getFitnessRouteData,
  getFitnessSummary,
  retryAllFitnessImports
} from './client/fitnessRoutes'
import { ApiRequestError, throwApiError } from './client/http'
import {
  type CompleteUploadPresignedUrlParams,
  type CreateUploadPresignedUrlParams,
  type GetActorMediaParams,
  type UploadFileToPresignedUrlParams,
  type UploadMediaParams,
  completeUploadPresignedUrl,
  createUploadPresignedUrl,
  getActorMedia,
  uploadAttachment,
  uploadFileToPresignedUrl,
  uploadMedia
} from './client/media'
import {
  type CreateNoteParams,
  type CreatePollParams,
  type DefaultStatusParams,
  type GetBookmarksParams,
  type GetBookmarksResult,
  type GetFavouritesParams,
  type GetFavouritesResult,
  type GetStatusFavouritedByParams,
  type GetStatusQuotesParams,
  type GetStatusQuotesResult,
  type ReactionUpdateResult,
  type RevokeStatusQuoteParams,
  type StatusFavouritedByResult,
  type TranslateStatusParams,
  type TranslationCapability,
  type TranslationLanguages,
  type UpdateNoteParams,
  type UpdateNoteResult,
  type UpdateStatusInteractionPolicyParams,
  type UpdateStatusVisibilityParams,
  type VotePollParams,
  bookmarkStatus,
  createNote,
  createPoll,
  deleteStatus,
  getBookmarks,
  getDefaultQuotePolicy,
  getFavourites,
  getStatusById,
  getStatusFavouritedBy,
  getStatusQuotes,
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus,
  reactToStatus,
  repostStatus,
  retryFitnessProcessing,
  revokeStatusQuote,
  translateStatus,
  undoBookmarkStatus,
  undoLikeStatus,
  undoRepostStatus,
  unreactFromStatus,
  updateNote,
  updateStatusInteractionPolicy,
  updateStatusVisibility,
  votePoll
} from './client/statuses'
import {
  type AddFeaturedTagResult,
  addFeaturedTag,
  getFeaturedTagSuggestions,
  getFeaturedTags,
  removeFeaturedTag
} from './client/tags'
import {
  type GetCollectionTimelineParams,
  type GetHashtagTimelineParams,
  type GetHashtagTimelineResult,
  type GetListTimelineParams,
  type GetTimelineParams,
  type GetTimelineResult,
  getCollectionFeed,
  getCollectionTimeline,
  getHashtagTimeline,
  getListTimeline,
  getTimeline
} from './client/timelines'
import {
  getTrendingLinks,
  getTrendingStatuses,
  getTrendingTags
} from './client/trends'

export { ApiRequestError }

export {
  type CreateNoteParams,
  createNote,
  type UpdateNoteParams,
  type UpdateNoteResult,
  updateNote,
  type UpdateStatusVisibilityParams,
  updateStatusVisibility,
  type CreatePollParams,
  createPoll,
  type DefaultStatusParams,
  deleteStatus,
  repostStatus,
  undoRepostStatus,
  type TranslateStatusParams,
  translateStatus,
  type TranslationCapability,
  getTranslationCapability,
  likeStatus,
  type ReactionUpdateResult,
  reactToStatus,
  unreactFromStatus,
  bookmarkStatus,
  undoBookmarkStatus,
  undoLikeStatus,
  type TranslationLanguages,
  getTranslationLanguages,
  type GetStatusFavouritedByParams,
  type StatusFavouritedByResult,
  getStatusFavouritedBy,
  type GetBookmarksParams,
  type GetBookmarksResult,
  getBookmarks,
  type GetFavouritesParams,
  type GetFavouritesResult,
  getFavourites,
  type VotePollParams,
  votePoll,
  type GetStatusQuotesParams,
  type GetStatusQuotesResult,
  getStatusQuotes,
  getStatusById,
  type RevokeStatusQuoteParams,
  revokeStatusQuote,
  type UpdateStatusInteractionPolicyParams,
  updateStatusInteractionPolicy,
  getDefaultQuotePolicy,
  retryFitnessProcessing
}

export {
  type ActorDomainsResult,
  type CancelActorDeletionParams,
  type CancelActorDeletionResult,
  type CreateActorParams,
  type CreateActorResult,
  type CreateReportParams,
  type DeleteAccountMediaParams,
  type DeleteActorParams,
  type DeleteActorResult,
  type DeleteSessionParams,
  type FollowParams,
  type FollowRequestParams,
  type FollowStatusType,
  type GetActorDomainsParams,
  type GetActorStatusesParams,
  type GetActorStatusesResult,
  type GetBlocksParams,
  type GetBlocksResult,
  type GetMutesParams,
  type GetMutesResult,
  type MuteParams,
  type ReportCategory,
  type RevokeConnectedAppParams,
  type SetDefaultActorParams,
  type SetDefaultActorResult,
  type SwitchActorParams,
  acceptFollowRequest,
  block,
  cancelActorDeletion,
  createActor,
  createReport,
  deleteAccountMedia,
  deleteActor,
  deleteSession,
  follow,
  getActorDomains,
  getActorStatuses,
  getBlocks,
  getFollowStatus,
  getMutes,
  getRelationship,
  isFollowing,
  mute,
  rejectFollowRequest,
  revokeConnectedApp,
  revokeOtherSessions,
  setDefaultActor,
  switchActor,
  unblock,
  unfollow,
  unmute
}

export {
  type AddFeaturedTagResult,
  addFeaturedTag,
  getFeaturedTags,
  getFeaturedTagSuggestions,
  removeFeaturedTag
}

export {
  type GetCollectionTimelineParams,
  type GetHashtagTimelineParams,
  type GetHashtagTimelineResult,
  type GetListTimelineParams,
  type GetTimelineParams,
  type GetTimelineResult,
  getCollectionFeed,
  getCollectionTimeline,
  getHashtagTimeline,
  getListTimeline,
  getTimeline
}

export { getTrendingLinks, getTrendingStatuses, getTrendingTags }

export {
  type CompleteUploadPresignedUrlParams,
  type CreateUploadPresignedUrlParams,
  type GetActorMediaParams,
  type UploadFileToPresignedUrlParams,
  type UploadMediaParams,
  completeUploadPresignedUrl,
  createUploadPresignedUrl,
  getActorMedia,
  uploadAttachment,
  uploadFileToPresignedUrl,
  uploadMedia
}

export {
  type ActiveStravaArchiveImport,
  type ActiveStravaArchiveImportResponse,
  type FitnessImportBatchFile,
  type FitnessImportBatchResult,
  type StartFitnessImportResult,
  type StartStravaArchiveImportResult,
  type StravaArchivePresignedResult,
  type UploadFitnessFileResult,
  cancelStravaArchiveImport,
  createStravaArchivePresignedUrl,
  getActiveStravaArchiveImport,
  retryStravaArchiveImport,
  startFitnessImport,
  startStravaArchiveImport,
  uploadFitnessFile
}

export {
  type FitnessProcessingState,
  type StatusFitnessFileItem,
  getAppleMapsToken,
  getFitnessFilesByStatus,
  getFitnessImportBatch,
  getFitnessProcessingState,
  retryFitnessImportBatch
}

interface MarkNotificationsReadParams {
  notificationIds: string[]
}

/**
 * Marks the given notifications as read for the current actor
 */
export const markNotificationsRead = async ({
  notificationIds
}: MarkNotificationsReadParams) => {
  const response = await fetch('/api/v1/notifications/read', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      notification_ids: notificationIds
    })
  })
  return response.ok
}

export {
  type FitnessActivitySummary,
  type FitnessRouteDataResponse,
  type FitnessRouteSample,
  type FitnessRouteSegment,
  type GetFitnessSummaryParams,
  deleteFitnessFile,
  getFitnessRouteData,
  getFitnessSummary,
  retryAllFitnessImports
}

// --- Fitness gear ---

export * from './client/fitnessGear'

export {
  type FitnessGeneralSettingsResponse,
  type FitnessPrivacyLocationInput,
  type RegenerateFitnessMapsResponse,
  getFitnessGeneralSettings,
  regenerateFitnessMaps,
  updateFitnessGeneralSettings
}

// --- Notification settings ---

export * from './client/notificationSettings'

// --- Preferences ---

export * from './client/accountPreferences'

// --- Fitness calendar and heatmaps ---

export * from './client/fitnessHeatmaps'
export * from './client/fitnessCalendar'

// --- Conversations ---

export * from './client/conversations'

// --- Search ---

export * from './client/search'

// --- Direct messages ---

export * from './client/directMessages'

// ============================================================================
// Custom emoji
// ============================================================================

// Public instance custom emoji (picker-visible, enabled). Used by the postbox
// sticker/emoji picker. Returns [] on failure so the picker degrades to system
// emoji only.
export const getCustomEmojis = async (): Promise<CustomEmoji[]> => {
  try {
    const response = await fetch('/api/v1/custom_emojis', {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) return []
    return (await response.json()) as CustomEmoji[]
  } catch {
    return []
  }
}

export const adminListCustomEmojis = async (): Promise<AdminCustomEmoji[]> => {
  const response = await fetch('/api/v1/admin/custom_emojis', {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error('Failed to load custom emoji')
  return (await response.json()) as AdminCustomEmoji[]
}

export interface AdminCreateCustomEmojiParams {
  shortcode: string
  image: File
  category?: string
  visibleInPicker?: boolean
}
export const adminCreateCustomEmoji = async ({
  shortcode,
  image,
  category,
  visibleInPicker
}: AdminCreateCustomEmojiParams): Promise<AdminCustomEmoji> => {
  const form = new FormData()
  form.set('shortcode', shortcode)
  form.set('image', image)
  if (category) form.set('category', category)
  if (visibleInPicker !== undefined) {
    form.set('visible_in_picker', visibleInPicker ? 'true' : 'false')
  }
  const response = await fetch('/api/v1/admin/custom_emojis', {
    method: 'POST',
    body: form
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to create custom emoji')
  }
  return (await response.json()) as AdminCustomEmoji
}

export interface AdminUpdateCustomEmojiParams {
  id: string
  category?: string | null
  visibleInPicker?: boolean
  disabled?: boolean
}
export const adminUpdateCustomEmoji = async ({
  id,
  category,
  visibleInPicker,
  disabled
}: AdminUpdateCustomEmojiParams): Promise<AdminCustomEmoji> => {
  const response = await fetch(`/api/v1/admin/custom_emojis/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(category !== undefined ? { category } : {}),
      ...(visibleInPicker !== undefined
        ? { visible_in_picker: visibleInPicker }
        : {}),
      ...(disabled !== undefined ? { disabled } : {})
    })
  })
  if (!response.ok) throw new Error('Failed to update custom emoji')
  return (await response.json()) as AdminCustomEmoji
}

export const adminDeleteCustomEmoji = async (id: string): Promise<void> => {
  const response = await fetch(`/api/v1/admin/custom_emojis/${id}`, {
    method: 'DELETE'
  })
  if (!response.ok) throw new Error('Failed to delete custom emoji')
}

// Database-backed admin server settings. Resolved values plus per-field lock
// metadata (env-pinned fields are locked and reject writes).
export interface AdminServerSettingsResponse {
  settings: ResolvedServerSettings
  locks: Record<string, { locked: boolean; envVar?: string }>
}

export const getAdminServerSettings =
  async (): Promise<AdminServerSettingsResponse> => {
    const response = await fetch('/api/v1/admin/server_settings', {
      headers: { Accept: 'application/json' }
    })
    if (!response.ok) throw new Error('Failed to load server settings')
    return (await response.json()) as AdminServerSettingsResponse
  }

// Partial { key: value } patch. Env-locked, unknown, or invalid keys are
// rejected server-side and nothing is written; the thrown message surfaces to
// the form.
export const updateAdminServerSettings = async (
  patch: Record<string, unknown>
): Promise<AdminServerSettingsResponse> => {
  const response = await fetch('/api/v1/admin/server_settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to save server settings')
  }
  return (await response.json()) as AdminServerSettingsResponse
}

// Lists (https://docs.joinmastodon.org/methods/lists/).
// The user's curated timelines and their members. Every list call goes through
// here so components never call fetch() directly. List ids are opaque strings
// (UUIDs), so unlike status/account ids they are not url/id encoded.

export interface ListParams {
  title: string
  repliesPolicy?: ListEntity['replies_policy']
  exclusive?: boolean
}

const listRequestBody = ({ title, repliesPolicy, exclusive }: ListParams) => ({
  title,
  ...(repliesPolicy !== undefined ? { replies_policy: repliesPolicy } : {}),
  ...(exclusive !== undefined ? { exclusive } : {})
})

export const createList = async (
  params: ListParams
): Promise<ListEntity | null> => {
  const response = await fetch('/api/v1/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listRequestBody(params))
  })
  if (!response.ok) return null
  return (await response.json()) as ListEntity
}

export interface UpdateListParams extends ListParams {
  listId: string
}

export const updateList = async ({
  listId,
  ...params
}: UpdateListParams): Promise<ListEntity | null> => {
  const response = await fetch(`/api/v1/lists/${encodeURIComponent(listId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(listRequestBody(params))
  })
  if (!response.ok) return null
  return (await response.json()) as ListEntity
}

export const deleteList = async (listId: string): Promise<boolean> => {
  const response = await fetch(`/api/v1/lists/${encodeURIComponent(listId)}`, {
    method: 'DELETE'
  })
  return response.ok
}

export interface ListAccountsMutationParams {
  listId: string
  accountIds: string[]
}

const mutateListAccounts = async (
  method: 'POST' | 'DELETE',
  { listId, accountIds }: ListAccountsMutationParams
): Promise<boolean> => {
  if (accountIds.length === 0) return true
  const response = await fetch(
    `/api/v1/lists/${encodeURIComponent(listId)}/accounts`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      // accountIds are already Mastodon Account ids (a publicId, or the legacy
      // `urlToId` form on a pre-backfill row); the route resolves either back
      // to an actor URI, so pass them through unchanged.
      body: JSON.stringify({ account_ids: accountIds })
    }
  )
  return response.ok
}

export const addListAccounts = (
  params: ListAccountsMutationParams
): Promise<boolean> => mutateListAccounts('POST', params)

export const removeListAccounts = (
  params: ListAccountsMutationParams
): Promise<boolean> => mutateListAccounts('DELETE', params)

// Collections (Mastodon 4.6 Collections API + activities.next feed extension).
// A collection is a shareable, consent-gated feed of accounts the owner
// highlights. Like list ids, collection ids are opaque UUIDs (not url/id
// encoded). Account ids are Mastodon Account ids (a publicId, or the legacy
// `urlToId` form on a pre-backfill row); the routes resolve either back to an
// actor URI, so pass them through unchanged.

export interface CollectionParams {
  title?: string
  description?: string | null
  topic?: string | null
  language?: string | null
  visibility?: CollectionEntity['visibility']
  feedEnabled?: boolean
}

const collectionRequestBody = ({
  title,
  description,
  topic,
  language,
  visibility,
  feedEnabled
}: CollectionParams) => ({
  ...(title !== undefined ? { title } : {}),
  // description/topic/language are nullable: an explicit `null` clears them, so
  // forward `null` while still omitting an `undefined` (untouched) field.
  ...(description !== undefined ? { description } : {}),
  ...(topic !== undefined ? { topic } : {}),
  ...(language !== undefined ? { language } : {}),
  ...(visibility !== undefined ? { visibility } : {}),
  ...(feedEnabled !== undefined ? { feed_enabled: feedEnabled } : {})
})

export interface CreateCollectionParams extends CollectionParams {
  title: string
}

export const createCollection = async (
  params: CreateCollectionParams
): Promise<CollectionEntity | null> => {
  const response = await fetch('/api/v1/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(collectionRequestBody(params))
  })
  if (!response.ok) return null
  // Mastodon 4.6 wraps the created collection; unwrap so component callers
  // keep receiving the entity itself.
  const data = (await response.json()) as { collection: CollectionEntity }
  return data.collection
}

export interface UpdateCollectionParams extends CollectionParams {
  collectionId: string
}

export const updateCollection = async ({
  collectionId,
  ...params
}: UpdateCollectionParams): Promise<CollectionEntity | null> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectionRequestBody(params))
    }
  )
  if (!response.ok) return null
  // Mastodon 4.6 wraps the updated collection; unwrap for component callers.
  const data = (await response.json()) as { collection: CollectionEntity }
  return data.collection
}

export const deleteCollection = async (
  collectionId: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

export interface CollectionAccountsMutationParams {
  collectionId: string
  accountIds: string[]
}

const mutateCollectionAccounts = async (
  method: 'POST' | 'DELETE',
  { collectionId, accountIds }: CollectionAccountsMutationParams
): Promise<boolean> => {
  if (accountIds.length === 0) return true
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(collectionId)}/items`,
    {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_ids: accountIds })
    }
  )
  return response.ok
}

export const addCollectionAccounts = (
  params: CollectionAccountsMutationParams
): Promise<boolean> => mutateCollectionAccounts('POST', params)

export const removeCollectionAccounts = (
  params: CollectionAccountsMutationParams
): Promise<boolean> => mutateCollectionAccounts('DELETE', params)

export interface CollectionMembershipParams {
  collectionId: string
  // The acting member's own Mastodon Account id (a publicId, or the legacy
  // `urlToId` form on a pre-backfill row). The approve/revoke routes accept it
  // as an extension alongside the Mastodon 4.6 CollectionItem id and require it
  // to resolve to the authenticated caller.
  accountId: string
}

const setCollectionMembership = async (
  action: 'approve' | 'revoke',
  { collectionId, accountId }: CollectionMembershipParams
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/collections/${encodeURIComponent(
      collectionId
    )}/items/${encodeURIComponent(accountId)}/${action}`,
    { method: 'POST' }
  )
  return response.ok
}

// A member opts IN to a collection's public projection (consent gate).
export const approveCollectionMembership = (
  params: CollectionMembershipParams
): Promise<boolean> => setCollectionMembership('approve', params)

// A member opts OUT of a collection's public projection.
export const revokeCollectionMembership = (
  params: CollectionMembershipParams
): Promise<boolean> => setCollectionMembership('revoke', params)

// Filters (https://docs.joinmastodon.org/methods/filters/).
// Keyword filters for the account scope (/api/v2/filters) and the instance
// scope (/api/v2/admin/filters). Server filters are returned merged into the
// account list flagged read-only via the non-standard `server` field. Filter
// ids are opaque UUIDs (not ActivityPub URLs), so unlike status/account ids
// they never go through toIdPathSegment — they are still escaped with
// encodeURIComponent when placed in a request path.

export interface ClientFilter extends MastodonFilter {
  // Present and true only on instance-wide server filters merged into the
  // account list — these are read-only for regular accounts.
  server?: boolean
}

export interface FilterKeywordInput {
  // Set when editing an existing keyword; omit to create a new one.
  id?: string
  keyword: string
  wholeWord: boolean
  // Set on an existing keyword to remove it during an update.
  _destroy?: boolean
}

export interface FilterInput {
  title: string
  context: FilterContext[]
  filterAction: FilterAction
  // Seconds until the filter expires, or null for "never".
  expiresIn: number | null
  keywords: FilterKeywordInput[]
}

const filterRequestBody = ({
  title,
  context,
  filterAction,
  expiresIn,
  keywords
}: FilterInput) => ({
  title,
  context,
  filter_action: filterAction,
  expires_in: expiresIn,
  keywords_attributes: keywords.map((keyword) => ({
    ...(keyword.id ? { id: keyword.id } : {}),
    keyword: keyword.keyword,
    whole_word: keyword.wholeWord,
    ...(keyword._destroy ? { _destroy: true } : {})
  }))
})

const requestFilters = async (path: string): Promise<ClientFilter[]> => {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an
  // empty list. Mirrors the throwing pattern used by createNote().
  if (!response.ok) {
    throw new Error(`Failed to load filters (${response.status})`)
  }
  return (await response.json()) as ClientFilter[]
}

const createFilterRequest = async (
  path: string,
  input: FilterInput
): Promise<ClientFilter | null> => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterRequestBody(input))
  })
  if (!response.ok) return null
  return (await response.json()) as ClientFilter
}

const updateFilterRequest = async (
  path: string,
  input: FilterInput
): Promise<ClientFilter | null> => {
  const response = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filterRequestBody(input))
  })
  if (!response.ok) return null
  return (await response.json()) as ClientFilter
}

const deleteFilterRequest = async (path: string): Promise<boolean> => {
  const response = await fetch(path, { method: 'DELETE' })
  return response.ok
}

export const getFilters = (): Promise<ClientFilter[]> =>
  requestFilters('/api/v2/filters')

export const createFilter = (
  input: FilterInput
): Promise<ClientFilter | null> => createFilterRequest('/api/v2/filters', input)

export const updateFilter = (
  id: string,
  input: FilterInput
): Promise<ClientFilter | null> =>
  updateFilterRequest(`/api/v2/filters/${encodeURIComponent(id)}`, input)

export const deleteFilter = (id: string): Promise<boolean> =>
  deleteFilterRequest(`/api/v2/filters/${encodeURIComponent(id)}`)

export const getServerFilters = (): Promise<ClientFilter[]> =>
  requestFilters('/api/v2/admin/filters')

export const createServerFilter = (
  input: FilterInput
): Promise<ClientFilter | null> =>
  createFilterRequest('/api/v2/admin/filters', input)

export const updateServerFilter = (
  id: string,
  input: FilterInput
): Promise<ClientFilter | null> =>
  updateFilterRequest(`/api/v2/admin/filters/${encodeURIComponent(id)}`, input)

export const deleteServerFilter = (id: string): Promise<boolean> =>
  deleteFilterRequest(`/api/v2/admin/filters/${encodeURIComponent(id)}`)

export type ServerRule = AdminRule

export interface ServerRuleInput {
  text: string
  hint: string
  position?: number
}

export const getServerRules = async (): Promise<ServerRule[]> => {
  const response = await fetch('/api/v2/admin/rules', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an
  // empty list. Mirrors the throwing pattern used by getServerFilters().
  if (!response.ok) {
    throw new Error(`Failed to load rules (${response.status})`)
  }
  return (await response.json()) as ServerRule[]
}

export const createServerRule = async (
  input: ServerRuleInput
): Promise<ServerRule | null> => {
  const response = await fetch('/api/v2/admin/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) return null
  return (await response.json()) as ServerRule
}

export const updateServerRule = async (
  id: string,
  input: Partial<ServerRuleInput>
): Promise<ServerRule | null> => {
  const response = await fetch(
    `/api/v2/admin/rules/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  )
  if (!response.ok) return null
  return (await response.json()) as ServerRule
}

export const deleteServerRule = async (id: string): Promise<boolean> => {
  const response = await fetch(
    `/api/v2/admin/rules/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

export type ServerAnnouncement = AdminAnnouncement

export interface ServerAnnouncementInput {
  text: string
  starts_at?: string | null
  ends_at?: string | null
  all_day?: boolean
  published?: boolean
}

export const getServerAnnouncements = async (): Promise<
  ServerAnnouncement[]
> => {
  const response = await fetch('/api/v2/admin/announcements', {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  // Throw (rather than returning []) so an HTTP error is surfaced by the
  // caller's error handling instead of being indistinguishable from an empty
  // list. Mirrors the throwing pattern used by getServerRules().
  if (!response.ok) {
    throw new Error(`Failed to load announcements (${response.status})`)
  }
  return (await response.json()) as ServerAnnouncement[]
}

export const createServerAnnouncement = async (
  input: ServerAnnouncementInput
): Promise<ServerAnnouncement | null> => {
  const response = await fetch('/api/v2/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  })
  if (!response.ok) return null
  return (await response.json()) as ServerAnnouncement
}

export const updateServerAnnouncement = async (
  id: string,
  input: Partial<ServerAnnouncementInput>
): Promise<ServerAnnouncement | null> => {
  const response = await fetch(
    `/api/v2/admin/announcements/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    }
  )
  if (!response.ok) return null
  return (await response.json()) as ServerAnnouncement
}

export const deleteServerAnnouncement = async (
  id: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v2/admin/announcements/${encodeURIComponent(id)}`,
    { method: 'DELETE' }
  )
  return response.ok
}

// Public announcements (https://docs.joinmastodon.org/methods/announcements/).
// The active server announcements shown to a signed-in user, each carrying a
// per-actor `read` flag. Distinct from the admin `getServerAnnouncements`
// management list above — these render published content for the timeline
// banner.

// Returns the active announcements for the current actor. Returns [] on a
// non-OK response so the timeline banner degrades to showing nothing rather
// than surfacing an error to the reader.
export const getAnnouncements = async (): Promise<Announcement[]> => {
  const response = await fetch('/api/v1/announcements', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) return []
  return (await response.json()) as Announcement[]
}

/**
 * Dismisses (marks as read) a single announcement for the current actor using
 * the Mastodon-compatible announcements API.
 * @see https://docs.joinmastodon.org/methods/announcements/#dismiss
 */
export const dismissAnnouncement = async (id: string): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/dismiss`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

/**
 * Adds the current actor's reaction (unicode emoji or custom-emoji shortcode)
 * to an announcement. Returns true on success. Mirrors `dismissAnnouncement`'s
 * boolean-ok style so the banner can fall back to its optimistic state.
 * @see https://docs.joinmastodon.org/methods/announcements/#put-reactions
 */
export const addAnnouncementReaction = async (
  id: string,
  name: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

/**
 * Removes the current actor's reaction from an announcement. Returns true on
 * success.
 * @see https://docs.joinmastodon.org/methods/announcements/#delete-reactions
 */
export const removeAnnouncementReaction = async (
  id: string,
  name: string
): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/announcements/${encodeURIComponent(id)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

// A passkey as returned by `GET /api/v1/passkeys`, including the domain it was
// registered on (a WebAuthn credential is bound to one domain).
export interface Passkey {
  id: string
  name: string | null
  domain: string
  deviceType: string
  backedUp: boolean
  createdAt: string
  aaguid: string | null
}

/**
 * Lists the signed-in account's passkeys with the domain each is bound to.
 * @see app/api/v1/passkeys/route.ts
 */
export const getPasskeys = async (): Promise<Passkey[]> => {
  const response = await fetch('/api/v1/passkeys', {
    method: 'GET',
    credentials: 'include'
  })
  if (!response.ok) {
    throw new Error('Failed to load passkeys')
  }
  const data = await response.json()
  return Array.isArray(data) ? data : []
}

// ============================================================================
// Admin moderation — accounts (Admin::Account) and reports (Admin::Report).
// All calls go through the same-origin cookie session (AdminApiGuard).
// ============================================================================

export interface AdminAccountFilters {
  origin?: 'local' | 'remote'
  status?: 'active' | 'pending' | 'disabled' | 'silenced' | 'suspended'
  username?: string
  byDomain?: string
}

export const getAdminAccounts = async (
  filters: AdminAccountFilters = {}
): Promise<AdminAccount[]> => {
  const params = new URLSearchParams()
  if (filters.origin) params.set('origin', filters.origin)
  if (filters.status) params.set('status', filters.status)
  if (filters.username) params.set('username', filters.username)
  if (filters.byDomain) params.set('by_domain', filters.byDomain)
  const query = params.toString()
  const response = await fetch(
    `/api/v2/admin/accounts${query ? `?${query}` : ''}`,
    { headers: { Accept: 'application/json' }, credentials: 'include' }
  )
  if (!response.ok) throw new Error('Failed to load admin accounts')
  return (await response.json()) as AdminAccount[]
}

export const getAdminAccount = async (id: string): Promise<AdminAccount> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include'
  })
  if (!response.ok) throw new Error('Failed to load admin account')
  return (await response.json()) as AdminAccount
}

export type AdminAccountActionType =
  'none' | 'disable' | 'sensitive' | 'silence' | 'suspend'

export const performAdminAccountAction = async ({
  id,
  type,
  reportId,
  text
}: {
  id: string
  type: AdminAccountActionType
  reportId?: string
  text?: string
}): Promise<void> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      type,
      ...(reportId ? { report_id: reportId } : {}),
      ...(text ? { text } : {})
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to perform account action')
  }
}

const adminAccountStateChange =
  (action: string) =>
  async (id: string): Promise<AdminAccount> => {
    const response = await fetch(`/api/v1/admin/accounts/${id}/${action}`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `Failed to ${action} account`)
    }
    return (await response.json()) as AdminAccount
  }

export const adminEnableAccount = adminAccountStateChange('enable')
export const adminUnsilenceAccount = adminAccountStateChange('unsilence')
export const adminUnsuspendAccount = adminAccountStateChange('unsuspend')
export const adminUnsensitiveAccount = adminAccountStateChange('unsensitive')
export const adminApproveAccount = adminAccountStateChange('approve')
export const adminRejectAccount = adminAccountStateChange('reject')

export const adminDeleteAccount = async (id: string): Promise<AdminAccount> => {
  const response = await fetch(`/api/v1/admin/accounts/${id}`, {
    method: 'DELETE',
    credentials: 'include'
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to delete account')
  }
  return (await response.json()) as AdminAccount
}

export const getAdminReports = async (
  resolved?: boolean
): Promise<AdminReport[]> => {
  const params = new URLSearchParams()
  if (resolved !== undefined)
    params.set('resolved', resolved ? 'true' : 'false')
  const query = params.toString()
  const response = await fetch(
    `/api/v1/admin/reports${query ? `?${query}` : ''}`,
    { headers: { Accept: 'application/json' }, credentials: 'include' }
  )
  if (!response.ok) throw new Error('Failed to load admin reports')
  return (await response.json()) as AdminReport[]
}

export const getAdminReport = async (id: string): Promise<AdminReport> => {
  const response = await fetch(`/api/v1/admin/reports/${id}`, {
    headers: { Accept: 'application/json' },
    credentials: 'include'
  })
  if (!response.ok) throw new Error('Failed to load admin report')
  return (await response.json()) as AdminReport
}

export const updateAdminReport = async ({
  id,
  category,
  ruleIds
}: {
  id: string
  category?: ReportCategory
  ruleIds?: string[]
}): Promise<AdminReport> => {
  const response = await fetch(`/api/v1/admin/reports/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      ...(category ? { category } : {}),
      ...(ruleIds ? { rule_ids: ruleIds } : {})
    })
  })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(error?.error ?? 'Failed to update report')
  }
  return (await response.json()) as AdminReport
}

const adminReportAction =
  (action: string) =>
  async (id: string): Promise<AdminReport> => {
    const response = await fetch(`/api/v1/admin/reports/${id}/${action}`, {
      method: 'POST',
      credentials: 'include'
    })
    if (!response.ok) {
      const error = await response.json().catch(() => null)
      throw new Error(error?.error ?? `Failed to ${action} report`)
    }
    return (await response.json()) as AdminReport
  }

export const assignAdminReportToSelf = adminReportAction('assign_to_self')
export const unassignAdminReport = adminReportAction('unassign')
export const resolveAdminReport = adminReportAction('resolve')
export const reopenAdminReport = adminReportAction('reopen')

/**
 * Resolves where to send a logged-out visitor so they can follow a local
 * account from their own fediverse server. The lookup runs server-side (the
 * visitor's WebFinger document is not readable from the browser), and the
 * returned URL is always absolute and https.
 */
export const getRemoteFollowUrl = async ({
  account,
  target
}: {
  account: string
  target: string
}): Promise<string> => {
  const params = new URLSearchParams({ account, target })
  const response = await fetch(`/api/v1/remote-follow?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    await throwApiError(response, 'Unable to reach that server')
  }

  const data = await response.json()
  if (typeof data?.url !== 'string') {
    throw new Error('Unable to reach that server')
  }
  return data.url
}

export const requestEmailChange = async ({
  newEmail
}: {
  newEmail: string
}): Promise<{ message: string }> => {
  const response = await fetch('/api/v1/accounts/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ newEmail })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to request email change')
  }
  return response.json()
}

export const updateAccountName = async ({
  name
}: {
  name: string
}): Promise<{ success: boolean }> => {
  const response = await fetch('/api/v1/accounts/name', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to update name')
  }
  return response.json()
}

export const changeAccountPassword = async ({
  currentPassword,
  newPassword
}: {
  currentPassword: string
  newPassword: string
}): Promise<{ success: boolean; message?: string }> => {
  const response = await fetch('/api/v1/accounts/password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ currentPassword, newPassword })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to change password')
  }
  return response.json()
}

export const requestPasswordReset = async ({
  email
}: {
  email: string
}): Promise<{ success: boolean; message: string }> => {
  const response = await fetch('/api/v1/accounts/password/reset/request', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to request password reset')
  }
  return response.json()
}

export const resetPassword = async ({
  code,
  newPassword
}: {
  code: string
  newPassword: string
}): Promise<{ success: boolean; message: string }> => {
  const response = await fetch('/api/v1/accounts/password/reset', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ code, newPassword })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to reset password')
  }
  return response.json()
}

export interface OAuthConsentResponse {
  redirect?: boolean
  url?: string
  // Legacy shape from the original custom consent handler.
  redirect_uri?: string
}

export type ConsentResponse = OAuthConsentResponse

export interface SubmitOAuthConsentParams {
  accept: boolean
  scope?: string
  oauth_query: string
}

export const submitOAuthConsent = async ({
  accept,
  scope,
  oauth_query
}: SubmitOAuthConsentParams): Promise<OAuthConsentResponse> => {
  const response = await fetch('/api/auth/oauth2/consent', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      accept,
      ...(scope !== undefined ? { scope } : {}),
      oauth_query
    })
  })
  if (!response.ok) {
    await throwApiError(response, 'Failed to submit consent')
  }
  return response.json()
}

export interface StravaSettingsResponse {
  configured: boolean
  actorId?: string
  actorHandle?: string
  clientId?: string
  connected?: boolean
  webhookUrl?: string
  defaultVisibility: MastodonVisibility
}

export type StravaSettings = StravaSettingsResponse

export interface GetStravaSettingsParams {
  signal?: AbortSignal
}

export const getStravaSettings = async (
  params?: GetStravaSettingsParams | AbortSignal
): Promise<StravaSettingsResponse> => {
  const signal = params instanceof AbortSignal ? params : params?.signal
  const response = await fetch('/api/v1/fitness/strava', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to load settings')
  }

  return response.json()
}

export interface SaveStravaSettingsParams {
  clientId?: string
  clientSecret?: string
  defaultVisibility?: MastodonVisibility
  signal?: AbortSignal
}

export interface SaveStravaSettingsResponse {
  success: boolean
  message: string
  authorizeUrl?: string
}

export const saveStravaSettings = async ({
  clientId,
  clientSecret,
  defaultVisibility,
  signal
}: SaveStravaSettingsParams): Promise<SaveStravaSettingsResponse> => {
  const body: {
    clientId?: string
    clientSecret?: string
    defaultVisibility?: MastodonVisibility
  } = {}
  if (clientId !== undefined) body.clientId = clientId
  if (clientSecret !== undefined) body.clientSecret = clientSecret
  if (defaultVisibility !== undefined)
    body.defaultVisibility = defaultVisibility

  const response = await fetch('/api/v1/fitness/strava', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to save settings')
  }

  return response.json()
}

export interface DeleteStravaSettingsParams {
  signal?: AbortSignal
}

export interface DeleteStravaSettingsResponse {
  success: boolean
  message: string
}

export const deleteStravaSettings = async (
  params?: DeleteStravaSettingsParams | AbortSignal
): Promise<DeleteStravaSettingsResponse> => {
  const signal = params instanceof AbortSignal ? params : params?.signal
  const response = await fetch('/api/v1/fitness/strava', {
    method: 'DELETE',
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to remove settings')
  }

  return response.json()
}
