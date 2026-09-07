import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { TimelineFormat } from '@/lib/services/timelines/const'
import type { DirectConversation } from '@/lib/types/database/operations'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { AdminAccount } from '@/lib/types/mastodon/admin/account'
import type { AdminReport } from '@/lib/types/mastodon/admin/report'
import type { Announcement } from '@/lib/types/mastodon/announcement'
import type { CollectionEntity } from '@/lib/types/mastodon/collection'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import type { Filter as MastodonFilter } from '@/lib/types/mastodon/filter'
import type { ListEntity } from '@/lib/types/mastodon/list'
import type { Tag } from '@/lib/types/mastodon/tag'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
// `toIdPathSegment` is the ONLY id transformation this module performs, and it
// only ever fires for a raw AP URI headed into a URL path segment. Every
// id-accepting route resolves a publicId, a legacy colon/`apurl_` id, or a raw
// URI, so re-encoding a client id here can only corrupt it — `urlToId` reads a
// UUIDv7 publicId as a bare host and hands back `<uuid>:`, which nothing can
// resolve. Ids in query params and JSON bodies go out verbatim.
import { idToUrl, toIdPathSegment } from '@/lib/utils/urlToId'

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
import { ApiRequestError, parseApiError, throwApiError } from './client/http'
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

export interface UploadFitnessFileResult {
  id: string
  type: 'fitness'
  file_type: 'fit' | 'gpx' | 'tcx' | 'zip'
  mime_type: string
  url: string
  fileName: string
  size: number
  description?: string
  hasMapData?: boolean
  mapImageUrl?: string
}

export interface FitnessImportBatchFile {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx' | 'zip'
  statusId: string | null
  isPrimary: boolean
  importStatus: 'pending' | 'completed' | 'failed'
  importError: string | null
  activityStartTime: number | null
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
}

export interface FitnessImportBatchResult {
  batchId: string
  status: 'pending' | 'completed' | 'failed' | 'partially_failed'
  summary: {
    total: number
    pending: number
    completed: number
    failed: number
  }
  files: FitnessImportBatchFile[]
}

export interface StartFitnessImportResult {
  batchId: string
  fileCount: number
}

export interface StartStravaArchiveImportResult {
  archiveId: string
  batchId: string
  importId: string
}

export interface ActiveStravaArchiveImport {
  id: string
  archiveId: string
  archiveFitnessFileId: string
  batchId: string
  visibility: MastodonVisibility
  status: 'importing' | 'failed'
  nextActivityIndex: number
  mediaAttachmentRetry: number
  totalActivitiesCount: number | null
  completedActivitiesCount: number
  failedActivitiesCount: number
  firstFailureMessage: string | null
  lastError: string | null
  pendingMediaActivitiesCount: number
  createdAt: number
  updatedAt: number
}

export interface ActiveStravaArchiveImportResponse {
  activeImport: ActiveStravaArchiveImport | null
}

export const uploadFitnessFile = async (
  file: File,
  description?: string
): Promise<UploadFitnessFileResult> => {
  const formData = new FormData()
  formData.append('file', file)
  if (description) {
    formData.append('description', description)
  }

  const response = await fetch('/api/v1/fitness-files', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to upload fitness file.'
    )

    throw new Error(
      `Failed to upload fitness file: ${response.status} ${errorDetails}`
    )
  }

  return response.json()
}

export const startFitnessImport = async (
  files: File[],
  visibility: MastodonVisibility
): Promise<StartFitnessImportResult> => {
  const formData = new FormData()
  files.forEach((file) => {
    formData.append('files', file)
  })
  formData.append('visibility', visibility)

  const response = await fetch('/api/v1/fitness/import', {
    method: 'POST',
    body: formData
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to import fitness files.'
    )
    throw new Error(
      `Failed to import fitness files: ${response.status} ${errorDetails}`
    )
  }

  return response.json()
}

interface StravaArchivePresignedResult {
  presigned: {
    url: string
    fitnessFileId: string
    archiveId: string
  }
}

export const createStravaArchivePresignedUrl = async (
  archive: File
): Promise<StravaArchivePresignedResult | null> => {
  const response = await fetch('/api/v1/fitness/strava/archive/presigned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: archive.name,
      contentType: archive.type || 'application/zip',
      size: archive.size
    })
  })
  if (response.status === 404) return null
  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to get presigned URL for archive'
    )
    throw new ApiRequestError(
      `Failed to get presigned URL for archive: ${response.status} ${errorDetails}`,
      response.status
    )
  }
  return response.json()
}

export const startStravaArchiveImport = async (
  archive: File,
  visibility: MastodonVisibility
): Promise<StartStravaArchiveImportResult> => {
  // Try presigned upload first (ObjectStorage/S3 backends)
  let presignedResult: StravaArchivePresignedResult | null = null
  try {
    presignedResult = await createStravaArchivePresignedUrl(archive)
  } catch (error) {
    if (
      error instanceof ApiRequestError &&
      error.status >= 400 &&
      error.status < 500
    ) {
      throw error
    }
  }

  if (presignedResult) {
    const { url, fitnessFileId, archiveId } = presignedResult.presigned

    try {
      // Upload archive directly to ObjectStorage via presigned PUT.
      await uploadFileToPresignedUrl({ presignedUrl: url, media: archive })
    } catch {
      // Presigned PUT failed (e.g. CORS not configured on the bucket).
      // Fall through to the server-side upload path below.
      presignedResult = null
    }

    if (presignedResult) {
      // Notify server to create import record and queue the job
      const response = await fetch('/api/v1/fitness/strava/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fitnessFileId, archiveId, visibility })
      })
      if (!response.ok) {
        throw new Error('Failed to start Strava archive import')
      }
      return response.json()
    }
  }

  // Fallback: upload archive through the Next.js server (LocalFile storage)
  const formData = new FormData()
  formData.append('archive', archive)
  formData.append('visibility', visibility)

  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'POST',
    body: formData
  })
  if (!response.ok) {
    throw new Error('Failed to start Strava archive import')
  }
  return response.json()
}

export const getActiveStravaArchiveImport =
  async (): Promise<ActiveStravaArchiveImportResponse> => {
    const response = await fetch('/api/v1/fitness/strava/archive', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      const errorDetails = await parseApiError(
        response,
        'Failed to load Strava archive import state.'
      )
      throw new Error(errorDetails)
    }

    return response.json()
  }

export const retryStravaArchiveImport = async (): Promise<{
  success: boolean
  activeImport: ActiveStravaArchiveImport | null
}> => {
  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'retry' })
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry Strava archive import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

export const cancelStravaArchiveImport = async (): Promise<{
  success: boolean
  cancelled: boolean
}> => {
  const response = await fetch('/api/v1/fitness/strava/archive', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'cancel' })
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to cancel Strava archive import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

export const getFitnessImportBatch = async (
  batchId: string
): Promise<FitnessImportBatchResult> => {
  const response = await fetch(
    `/api/v1/fitness/import/${encodeURIComponent(batchId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to fetch fitness import batch.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  return response.json()
}

export const retryFitnessImportBatch = async (
  batchId: string,
  visibility: MastodonVisibility
): Promise<{ batchId: string; retried: number }> => {
  const response = await fetch(
    `/api/v1/fitness/import/${encodeURIComponent(batchId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ visibility })
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry fitness import.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

export interface FitnessProcessingState {
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStuck: boolean
  hasMapData: boolean
}

/**
 * Returns the processing state of a status's primary fitness file so a
 * processing post can poll for progress and resolve to its finished state
 * without a manual reload. Returns null when the status has no fitness file
 * (e.g. it was deleted) so callers can stop polling.
 */
export const getFitnessProcessingState = async (
  statusId: string
): Promise<FitnessProcessingState | null> => {
  const response = await fetch(
    `/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(statusId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to fetch fitness processing state.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  const data = (await response.json()) as {
    files?: Array<{
      isPrimary?: boolean
      processingStatus?: FitnessProcessingState['processingStatus']
      processingStuck?: boolean
      hasMapData?: boolean
    }>
  }

  const files = data.files ?? []
  if (files.length === 0) {
    return null
  }

  // The post surfaces its primary file; fall back to the first file when no
  // file is flagged primary (older rows default to primary anyway).
  const primary = files.find((file) => file.isPrimary) ?? files[0]

  return {
    processingStatus: primary.processingStatus ?? 'pending',
    processingStuck: Boolean(primary.processingStuck),
    hasMapData: Boolean(primary.hasMapData)
  }
}

export interface StatusFitnessFileItem {
  id: string
  actorId: string
  fileName: string
  fileType: 'fit' | 'gpx' | 'tcx'
  statusId: string | null
  isPrimary: boolean
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  totalDistanceMeters: number | null
  totalDurationSeconds: number | null
  movingTimeSeconds: number | null
  elevationGainMeters: number | null
  activityType: string | null
  activityStartTime: number | null
  hasMapData: boolean
  description: string | null
  deviceManufacturer: string | null
  deviceName: string | null
  sourceUrl: string | null
  gearId: string | null
  gearName: string | null
  deviceGearId: string | null
  deviceGearName: string | null
}

export interface FitnessRouteSample {
  lat: number
  lng: number
  elapsedSeconds: number
  timestamp?: number
  altitude?: number
  heartRate?: number
  speed?: number
  isHiddenByPrivacy?: boolean
}

export interface FitnessRouteSegment {
  isHiddenByPrivacy: boolean
  samples: FitnessRouteSample[]
}

export interface FitnessRouteDataResponse {
  samples: FitnessRouteSample[]
  segments?: FitnessRouteSegment[]
  totalDurationSeconds: number
  powerSeries?: number[]
  heartRateSeries?: number[]
  altitudeSeries?: number[]
  speedSeries?: number[]
}

/**
 * Lists every fitness file attached to a status (an activity can aggregate
 * several uploaded files). Returns null when the endpoint is unavailable so the
 * caller can fall back to the file metadata embedded in the status payload.
 */
export const getFitnessFilesByStatus = async (
  statusId: string
): Promise<StatusFitnessFileItem[] | null> => {
  const response = await fetch(
    `/api/v1/fitness-files/by-status?statusId=${encodeURIComponent(statusId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) return null

  const data = (await response.json()) as {
    files?: StatusFitnessFileItem[]
  } | null
  return data && Array.isArray(data.files) ? data.files : null
}

/**
 * Fetches a short-lived Apple MapKit JS authorization token. Returns `null` when
 * the instance is not configured for the Apple map provider, or on any failure,
 * so the caller can fall back to another provider. The token is deliberately not
 * cached: MapKit re-invokes its `authorizationCallback` when the token expires.
 */
export const getAppleMapsToken = async (): Promise<string | null> => {
  try {
    const response = await fetch('/api/v1/fitness/apple-maps-token', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })
    if (!response.ok) return null

    const data = (await response.json()) as { token?: string } | null
    return typeof data?.token === 'string' ? data.token : null
  } catch {
    return null
  }
}

/**
 * Fetches the parsed route samples and metric time series (altitude / speed /
 * power / heart rate) for a fitness file, used to draw the activity map and the
 * Analysis charts. Throws when the request fails or the payload is malformed so
 * the caller can fall back to the static map preview.
 */
export const getFitnessRouteData = async (
  fitnessFileId: string
): Promise<FitnessRouteDataResponse> => {
  const response = await fetch(
    `/api/v1/fitness-files/${encodeURIComponent(fitnessFileId)}/route-data`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to load route data.'
    )
    throw new ApiRequestError(errorDetails, response.status)
  }

  const data = (await response.json()) as FitnessRouteDataResponse | null
  // Throw (rather than return an empty fallback) on a malformed/null payload so
  // the caller's catch can surface the error state; guard the null case first to
  // avoid a raw TypeError when reading `.samples`.
  if (!data || !Array.isArray(data.samples)) {
    throw new Error('Route data response is invalid')
  }

  return data
}

/**
 * Retries every failed/stuck fitness import for the current actor in one call,
 * so the owner doesn't have to retry each post individually.
 */
export const retryAllFitnessImports = async (): Promise<{
  retried: number
  batches: number
  failedBatches: number
}> => {
  const response = await fetch('/api/v1/fitness/retry-failed', {
    method: 'POST'
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry fitness imports.'
    )
    throw new Error(errorDetails)
  }

  return response.json()
}

export interface FitnessActivitySummary {
  activityType: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
  totalElevationGainMeters: number
}

interface GetFitnessSummaryParams {
  actorId: string
  startDate: number
  endDate: number
}

export const getFitnessSummary = async ({
  actorId,
  startDate,
  endDate
}: GetFitnessSummaryParams): Promise<FitnessActivitySummary[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-summary`
  )
  url.searchParams.append('start_date', `${startDate}`)
  url.searchParams.append('end_date', `${endDate}`)
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch fitness summary: ${response.status}`)
  }
  return response.json()
}

export const deleteFitnessFile = async (id: string): Promise<void> => {
  const response = await fetch(`/api/v1/accounts/fitness-files/${id}`, {
    method: 'DELETE'
  })

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to delete fitness file.'
    )
    throw new Error(errorDetails)
  }
}

// --- Fitness gear ---

export * from './client/fitnessGear'

// --- Fitness general (privacy location) settings ---

export interface FitnessGeneralSettingsResponse {
  success?: boolean
  error?: string
  privacyLocations?: Array<{
    latitude: number
    longitude: number
    hideRadiusMeters: number
  }>
  privacyHomeLatitude?: number | null
  privacyHomeLongitude?: number | null
  privacyHideRadiusMeters?: number
}

export interface FitnessPrivacyLocationInput {
  latitude: number
  longitude: number
  hideRadiusMeters: number
}

export interface RegenerateFitnessMapsResponse {
  success?: boolean
  error?: string
  queuedCount?: number
}

// A bare cast would let any 200 with any body count as a loaded settings
// object. `privacyLocations` would then read as an empty list, and because a
// save REPLACES the whole stored list, the next save would wipe every zone the
// actor configured. Reject the body instead so the caller's load-failure path
// handles it.
const assertFitnessGeneralSettings = (
  value: unknown
): FitnessGeneralSettingsResponse => {
  if (
    !value ||
    typeof value !== 'object' ||
    !Array.isArray((value as FitnessGeneralSettingsResponse).privacyLocations)
  ) {
    throw new Error('Unexpected fitness privacy settings response')
  }

  return value as FitnessGeneralSettingsResponse
}

export const getFitnessGeneralSettings =
  async (): Promise<FitnessGeneralSettingsResponse> => {
    const response = await fetch('/api/v1/fitness/general', {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error('Failed to load fitness privacy settings')
    }

    return assertFitnessGeneralSettings(await response.json())
  }

export const updateFitnessGeneralSettings = async (
  privacyLocations: FitnessPrivacyLocationInput[]
): Promise<{ ok: boolean; data: FitnessGeneralSettingsResponse }> => {
  const response = await fetch('/api/v1/fitness/general', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      privacyLocations
    })
  })

  const data = (await response.json()) as FitnessGeneralSettingsResponse

  // On success the caller rebuilds its list from this body, so an unrecognised
  // 200 must not be reported as a save — it would blank the list under a
  // "saved" message and invite the user to save the emptiness for real.
  if (response.ok) {
    return { ok: true, data: assertFitnessGeneralSettings(data) }
  }

  return { ok: false, data }
}

export const regenerateFitnessMaps = async (): Promise<{
  ok: boolean
  data: RegenerateFitnessMapsResponse
}> => {
  const response = await fetch('/api/v1/fitness/general/regenerate-maps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })

  const data = (await response.json()) as RegenerateFitnessMapsResponse
  return { ok: response.ok, data }
}

// --- Notification settings ---

export const getVapidKey = async (): Promise<string | null> => {
  const response = await fetch('/api/v1/push/vapid-key')
  if (!response.ok) return null
  const data = await response.json()
  return data.vapidPublicKey as string
}

export const updateEmailNotifications = async (
  actorId: string,
  settings: Record<string, boolean>
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/email-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, ...settings })
  })
  return response.ok
}

export const subscribePushNotifications = async (
  endpoint: string,
  keys: { p256dh: string; auth: string }
): Promise<boolean> => {
  const response = await fetch('/api/v1/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, keys })
  })
  return response.ok
}

export const unsubscribePushNotifications = async (
  endpoint: string
): Promise<boolean> => {
  const response = await fetch('/api/v1/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint })
  })
  return response.ok
}

export const updatePushNotifications = async (
  actorId: string,
  settings: Record<string, boolean>
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/push-notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId, ...settings })
  })
  return response.ok
}

// --- Preferences ---

export interface PreferencesInput {
  // Posting defaults — saved through the standard Mastodon credential endpoint.
  visibility: 'public' | 'unlisted' | 'private' | 'direct'
  // Default quote-approval policy for new public/unlisted posts (Mastodon 4.5).
  quotePolicy: QuoteApprovalPolicy
  sensitive: boolean
  language: string
  // Reading preferences — saved through the web-internal endpoint.
  expandMedia: 'default' | 'show_all' | 'hide_all'
  expandSpoilers: boolean
  autoplayGifs: boolean
}

// Persists posting defaults and reading preferences. Posting defaults go to
// PATCH /api/v1/accounts/update_credentials (the documented Mastodon write path
// third-party clients also use); reading preferences go to the web-internal
// endpoint since GET /api/v1/preferences is read-only by design.
//
// The two writes run sequentially and the reading POST is skipped if the
// posting PATCH fails. This narrows — but does not eliminate — the partial-
// update window: if the PATCH succeeds and the POST then fails, the posting
// defaults are already persisted while the reading prefs are not. Both writes
// are idempotent, so retrying after any failure re-applies the identical
// payloads and converges to a consistent state.
export const updatePreferences = async (
  preferences: PreferencesInput
): Promise<boolean> => {
  const postingResponse = await fetch('/api/v1/accounts/update_credentials', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: {
        privacy: preferences.visibility,
        quote_policy: preferences.quotePolicy,
        sensitive: preferences.sensitive,
        language: preferences.language
      }
    })
  })
  if (!postingResponse.ok) return false

  const readingResponse = await fetch('/api/v1/accounts/reading-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      readingExpandMedia: preferences.expandMedia,
      readingExpandSpoilers: preferences.expandSpoilers,
      readingAutoplayGifs: preferences.autoplayGifs
    })
  })
  return readingResponse.ok
}

// --- Navigation customization ---

export interface NavigationPreferencesInput {
  // The user's sidebar order and the items tucked under "More". Both are full
  // snapshots: the caller sends the entire list on every save so concurrent
  // edits resolve to last-write-wins rather than interleaving deltas. Empty
  // arrays reset to the shipped defaults.
  navOrder: string[]
  navHidden: string[]
}

export const updateNavigationPreferences = async (
  preferences: NavigationPreferencesInput
): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/navigation-preferences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences)
  })
  return response.ok
}

export * from './client/fitnessHeatmaps'

export interface FitnessCalendarDay {
  date: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
}

export const getFitnessCalendarData = async ({
  actorId,
  startDate,
  endDate,
  activityType
}: {
  actorId: string
  startDate: number
  endDate: number
  activityType?: string
}): Promise<FitnessCalendarDay[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-calendar`
  )
  url.searchParams.append('start_date', `${startDate}`)
  url.searchParams.append('end_date', `${endDate}`)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) return []
  return response.json()
}

export type DirectConversationView = DirectConversation & {
  accounts: MastodonAccount[]
}

export interface GetConversationsResult {
  conversations: DirectConversationView[]
}

export const getConversations = async ({
  limit,
  maxId,
  minId
}: {
  limit?: number
  maxId?: string
  minId?: string
} = {}): Promise<GetConversationsResult> => {
  const url = new URL(`${window.origin}/api/v1/conversations`)
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (limit !== undefined) url.searchParams.set('limit', `${limit}`)
  if (maxId) url.searchParams.set('max_id', maxId)
  if (minId) url.searchParams.set('min_id', minId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) return { conversations: [] }

  const data = (await response.json()) as Partial<GetConversationsResult>
  return { conversations: data.conversations ?? [] }
}

export interface GetConversationStatusesResult {
  statuses: Status[]
  nextMaxStatusId: string | null
}

export const getConversationStatuses = async ({
  conversationId,
  maxStatusId,
  minStatusId,
  limit
}: {
  conversationId: string
  maxStatusId?: string
  minStatusId?: string
  limit?: number
}): Promise<GetConversationStatusesResult> => {
  const url = new URL(
    `${window.origin}/api/v1/conversations/${conversationId}/statuses`
  )
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    return { statuses: [], nextMaxStatusId: null }
  }

  const data = (await response.json()) as Partial<GetConversationStatusesResult>
  return {
    statuses: data.statuses ?? [],
    nextMaxStatusId: data.nextMaxStatusId ?? null
  }
}

export const markConversationRead = async ({
  conversationId
}: {
  conversationId: string
}) => {
  const response = await fetch(`/api/v1/conversations/${conversationId}/read`, {
    method: 'POST',
    headers: { Accept: 'application/json' }
  })
  return response.ok
}

export const hideConversation = async ({
  conversationId
}: {
  conversationId: string
}) => {
  const response = await fetch(`/api/v1/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  return response.ok
}

export type SearchType = 'accounts' | 'statuses' | 'hashtags'

export interface SearchResult<TStatus = Status> {
  accounts: MastodonAccount[]
  statuses: TStatus[]
  hashtags: Tag[]
}

export interface SearchParams {
  q: string
  type?: SearchType
  limit?: number
  offset?: number
  resolve?: boolean
  signal?: AbortSignal
}

const emptySearchResult = (): SearchResult => ({
  accounts: [],
  statuses: [],
  hashtags: []
})

const MAX_SEARCH_ERROR_DETAIL_LENGTH = 200

const truncateSearchErrorDetail = (detail: string) =>
  detail.length > MAX_SEARCH_ERROR_DETAIL_LENGTH
    ? `${detail.slice(0, MAX_SEARCH_ERROR_DETAIL_LENGTH)}...`
    : detail

const getSearchResponseErrorMessage = (response: Response, text: string) => {
  let detail = text || response.statusText

  try {
    const data = JSON.parse(text) as Record<string, unknown>
    detail =
      typeof data.message === 'string'
        ? data.message
        : typeof data.error === 'string'
          ? data.error
          : typeof data.status === 'string'
            ? data.status
            : detail
  } catch {
    // Keep the raw response text for non-JSON failures.
  }

  detail = truncateSearchErrorDetail(detail)
  return `Search request failed (${response.status})${detail ? `: ${detail}` : ''}`
}

export const search = async ({
  q,
  type,
  limit,
  offset,
  resolve = true,
  signal
}: SearchParams): Promise<SearchResult> => {
  const params = new URLSearchParams({
    q,
    resolve: resolve ? 'true' : 'false',
    format: 'activities_next'
  })
  if (type) params.set('type', type)
  if (limit !== undefined) params.set('limit', `${limit}`)
  if (offset !== undefined) params.set('offset', `${offset}`)

  const response = await fetch(`/api/v2/search?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(getSearchResponseErrorMessage(response, text))
  }
  try {
    return JSON.parse(text) as SearchResult
  } catch {
    return emptySearchResult()
  }
}

export const searchAccounts = async ({
  q,
  limit = 5,
  resolve = true,
  signal
}: {
  q: string
  limit?: number
  resolve?: boolean
  signal?: AbortSignal
}): Promise<MastodonAccount[]> => {
  const url = new URL(`${window.origin}/api/v1/accounts/search`)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', `${limit}`)
  url.searchParams.set('resolve', resolve ? 'true' : 'false')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal
  })
  if (!response.ok) return []
  return (await response.json()) as MastodonAccount[]
}

const accountMention = (account: MastodonAccount) =>
  `@${account.acct || account.username}`

const getReplyParticipantIds = (replyStatus: Status) =>
  new Set(
    [replyStatus.actorId, ...replyStatus.to, ...replyStatus.cc]
      .map((id) => normalizeActorId(id))
      .filter((id): id is string => Boolean(id))
  )

const isReplyParticipant = (
  account: MastodonAccount,
  replyParticipantIds: Set<string>
) => {
  // The participant set holds ActivityPub actor URIs, so `uri` is the only
  // encoding-independent key. `url` is a profile URL (`/@name`) on some
  // accounts, and `id` is a publicId that cannot be decoded back to a URI at
  // all, so both stay as fallbacks for entities built before the id flip.
  for (const candidate of [account.uri, account.url, idToUrl(account.id)]) {
    if (!candidate) continue
    const accountActorId = normalizeActorId(candidate)
    if (accountActorId && replyParticipantIds.has(accountActorId)) return true
  }
  return false
}

export interface CreateDirectMessageResult {
  uri: string
  [key: string]: unknown
}

export const createDirectMessage = async ({
  message,
  recipients,
  replyStatus
}: {
  message: string
  recipients: MastodonAccount[]
  replyStatus?: Status
}): Promise<CreateDirectMessageResult> => {
  const normalizedMessage = message.trim()
  if (!normalizedMessage) {
    throw new Error('Message must not be empty')
  }
  if (recipients.length === 0 && !replyStatus) {
    throw new Error('At least one recipient is required')
  }

  const replyParticipantIds = replyStatus
    ? getReplyParticipantIds(replyStatus)
    : null
  const recipientsToMention = replyParticipantIds
    ? recipients.filter(
        (recipient) => !isReplyParticipant(recipient, replyParticipantIds)
      )
    : recipients
  const mentionPrefix = recipientsToMention.map(accountMention).join(' ')
  const status = [mentionPrefix, normalizedMessage].filter(Boolean).join(' ')
  const response = await fetch('/api/v1/statuses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    // `replyStatus.id` is the raw AP URI of the status being replied to; POST
    // /api/v1/statuses resolves `in_reply_to_id` through resolveStatusIdParam,
    // which passes a raw URI straight through, so send it unencoded.
    body: JSON.stringify({
      status,
      visibility: 'direct',
      ...(replyStatus ? { in_reply_to_id: replyStatus.id } : {})
    })
  })
  if (!response.ok) {
    throw new Error('Failed to send message')
  }
  return (await response.json()) as CreateDirectMessageResult
}

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
