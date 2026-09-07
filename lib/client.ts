import type { ResolvedServerSettings } from '@/lib/config/serverSettings'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import { PresignedUrlOutput } from '@/lib/services/medias/types'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import type { DirectConversation } from '@/lib/types/database/operations'
import { Attachment, UploadedAttachment } from '@/lib/types/domain/attachment'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import type { AdminAccount } from '@/lib/types/mastodon/admin/account'
import type { AdminReport } from '@/lib/types/mastodon/admin/report'
import type { Announcement } from '@/lib/types/mastodon/announcement'
import type { CollectionEntity } from '@/lib/types/mastodon/collection'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import type { Filter as MastodonFilter } from '@/lib/types/mastodon/filter'
import type { ListEntity } from '@/lib/types/mastodon/list'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { Tag } from '@/lib/types/mastodon/tag'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
// `toIdPathSegment` is the ONLY id transformation this module performs, and it
// only ever fires for a raw AP URI headed into a URL path segment. Every
// id-accepting route resolves a publicId, a legacy colon/`apurl_` id, or a raw
// URI, so re-encoding a client id here can only corrupt it — `urlToId` reads a
// UUIDv7 publicId as a bare host and hands back `<uuid>:`, which nothing can
// resolve. Ids in query params and JSON bodies go out verbatim.
import { idToUrl, toIdPathSegment } from '@/lib/utils/urlToId'
import { waitFor } from '@/lib/utils/waitFor'

import { ApiRequestError, parseApiError, throwApiError } from './client/http'
import {
  type CreateNoteParams,
  type CreatePollParams,
  type DefaultStatusParams,
  type GetStatusFavouritedByParams,
  type GetStatusQuotesParams,
  type GetStatusQuotesResult,
  type ReactionUpdateResult,
  type StatusFavouritedByResult,
  type TranslateStatusParams,
  type TranslationCapability,
  type TranslationLanguages,
  type UpdateNoteParams,
  type UpdateNoteResult,
  type UpdateStatusVisibilityParams,
  type VotePollParams,
  bookmarkStatus,
  createNote,
  createPoll,
  deleteStatus,
  getStatusById,
  getStatusFavouritedBy,
  getStatusQuotes,
  getTranslationCapability,
  getTranslationLanguages,
  likeStatus,
  reactToStatus,
  repostStatus,
  translateStatus,
  undoBookmarkStatus,
  undoLikeStatus,
  undoRepostStatus,
  unreactFromStatus,
  updateNote,
  updateStatusVisibility,
  votePoll
} from './client/statuses'

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
  type VotePollParams,
  votePoll,
  type GetStatusQuotesParams,
  type GetStatusQuotesResult,
  getStatusQuotes,
  getStatusById
}

export type ReportCategory = 'spam' | 'legal' | 'violation' | 'other'

interface CreateReportParams {
  targetActorId: string
  statusId?: string
  category?: ReportCategory
  comment?: string
}

/**
 * Reports an account (optionally tied to a status) using the
 * Mastodon-compatible reports API.
 * @see https://docs.joinmastodon.org/methods/reports/#post
 */
export const createReport = async ({
  targetActorId,
  statusId,
  category,
  comment
}: CreateReportParams): Promise<boolean> => {
  const response = await fetch('/api/v1/reports', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    // Ids in a JSON body are never re-encoded: /api/v1/reports resolves
    // `account_id`/`status_ids` through resolveActorIdParam /
    // resolveStatusIdParams, which take a publicId, a legacy colon/`apurl_`
    // id, or a raw AP URI as-is.
    body: JSON.stringify({
      account_id: targetActorId,
      ...(statusId ? { status_ids: [statusId] } : {}),
      ...(category ? { category } : {}),
      ...(comment ? { comment } : {})
    })
  })
  return response.status === 200
}

interface FollowParams {
  targetActorId: string
}

export type FollowStatusType = 'not_following' | 'requested' | 'following'

/**
 * Gets the follow status of the current user to the target actor
 * @returns 'following' if actively following, 'requested' if follow is pending approval, 'not_following' otherwise
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const getFollowStatus = async ({
  targetActorId
}: FollowParams): Promise<FollowStatusType> => {
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodeURIComponent(targetActorId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) {
    return 'not_following'
  }

  const relationships = await response.json()
  if (!relationships.length) return 'not_following'

  const relationship = relationships[0]
  if (relationship.following === true) {
    return 'following'
  }
  if (relationship.requested === true) {
    return 'requested'
  }
  return 'not_following'
}

/**
 * Checks if current user is following the target actor using Mastodon-compatible API
 * @deprecated Use getFollowStatus for more detailed status including pending requests
 * @see https://docs.joinmastodon.org/methods/accounts/#relationships
 */
export const isFollowing = async ({ targetActorId }: FollowParams) => {
  const status = await getFollowStatus({ targetActorId })
  return status === 'following'
}

/**
 * Follows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#follow
 */
export const follow = async ({ targetActorId }: FollowParams) => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/follow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

/**
 * Unfollows an account using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/accounts/#unfollow
 */
export const unfollow = async ({ targetActorId }: FollowParams) => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unfollow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

interface FollowRequestParams {
  id: string
}

const respondToFollowRequest = async (
  id: string,
  action: 'authorize' | 'reject'
) => {
  const response = await fetch(
    `/api/v1/follow_requests/${encodeURIComponent(id)}/${action}`,
    {
      method: 'POST'
    }
  )
  return response.ok
}

/**
 * Accepts a pending follow request using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/follow_requests/#accept
 */
export const acceptFollowRequest = ({ id }: FollowRequestParams) =>
  respondToFollowRequest(id, 'authorize')

/**
 * Rejects a pending follow request using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/follow_requests/#reject
 */
export const rejectFollowRequest = ({ id }: FollowRequestParams) =>
  respondToFollowRequest(id, 'reject')

export interface SwitchActorParams {
  actorId: string
}

/**
 * Switches the current session to another actor owned by the account
 */
export const switchActor = async ({ actorId }: SwitchActorParams) => {
  const response = await fetch('/api/v1/actors/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId })
  })
  return response.ok
}

export interface ActorDomainsResult {
  domains: string[]
  host: string
}

export interface GetActorDomainsParams {
  signal?: AbortSignal
}

/**
 * Fetches the allowed domains for actor creation
 */
export const getActorDomains = async ({
  signal
}: GetActorDomainsParams = {}): Promise<ActorDomainsResult> => {
  const response = await fetch('/api/v1/actors/domains', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to fetch actor domains')
  }

  const data = await response.json()
  return {
    domains: Array.isArray(data?.domains) ? data.domains : [],
    host: typeof data?.host === 'string' ? data.host : ''
  }
}

export interface CreateActorParams {
  username: string
  domain?: string
}

export interface CreateActorResult {
  id: string
  username: string
  domain: string
}

/**
 * Creates a new actor for the current account
 */
export const createActor = async ({
  username,
  domain
}: CreateActorParams): Promise<CreateActorResult> => {
  const response = await fetch('/api/v1/actors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      username,
      domain
    })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to create actor')
  }

  return (await response.json()) as CreateActorResult
}

export interface CancelActorDeletionParams {
  actorId: string
}

export interface CancelActorDeletionResult {
  actorId: string
  status: string
}

/**
 * Cancels a scheduled actor deletion
 */
export const cancelActorDeletion = async ({
  actorId
}: CancelActorDeletionParams): Promise<CancelActorDeletionResult> => {
  const response = await fetch('/api/v1/actors/cancel-deletion', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to cancel actor deletion')
  }

  return (await response.json()) as CancelActorDeletionResult
}

export interface SetDefaultActorParams {
  actorId: string
}

export interface SetDefaultActorResult {
  defaultActorId: string
  id: string
  username: string
  domain: string
}

/**
 * Sets the default actor for the current account
 */
export const setDefaultActor = async ({
  actorId
}: SetDefaultActorParams): Promise<SetDefaultActorResult> => {
  const response = await fetch('/api/v1/actors/default', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to update default actor')
  }

  return (await response.json()) as SetDefaultActorResult
}

export interface DeleteActorParams {
  actorId: string
  delayDays?: number
}

export interface DeleteActorResult {
  actorId: string
  status: string
  scheduledAt: string | null
  immediate: boolean
}

/**
 * Schedules or immediately executes deletion of an actor
 */
export const deleteActor = async ({
  actorId,
  delayDays = 0
}: DeleteActorParams): Promise<DeleteActorResult> => {
  const response = await fetch('/api/v1/actors/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ actorId, delayDays })
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to delete actor')
  }

  return (await response.json()) as DeleteActorResult
}

export interface DeleteAccountMediaParams {
  mediaId: string
}

/**
 * Deletes a media item owned by the current account
 */
export const deleteAccountMedia = async ({
  mediaId
}: DeleteAccountMediaParams): Promise<boolean> => {
  const response = await fetch(
    `/api/v1/accounts/media/${encodeURIComponent(mediaId)}`,
    {
      method: 'DELETE'
    }
  )

  if (!response.ok) {
    await throwApiError(response, 'Failed to delete media')
  }

  return true
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

export const getRelationship = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodeURIComponent(targetActorId)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (response.status !== 200) return null

  const relationships = (await response.json()) as MastodonRelationship[]
  return relationships[0] ?? null
}

export const block = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/block`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return null
  return (await response.json()) as MastodonRelationship
}

export const unblock = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unblock`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return null
  return (await response.json()) as MastodonRelationship
}

interface GetBlocksParams {
  limit?: number
  maxId?: string
  minId?: string
}

interface GetBlocksResult {
  accounts: MastodonAccount[]
  nextMaxId: string | null
  prevMinId: string | null
}

const getCursorFromLinkHeader = (linkHeader: string | null, rel: string) => {
  if (!linkHeader) return null

  const links = linkHeader.split(',').map((item) => item.trim())
  const matchingLink = links.find((link) => link.endsWith(`rel="${rel}"`))
  const url = matchingLink?.match(/<([^>]+)>/)?.[1]
  if (!url) return null

  return new URL(url).searchParams.get(rel === 'next' ? 'max_id' : 'min_id')
}

export const getBlocks = async ({
  limit,
  maxId,
  minId
}: GetBlocksParams = {}): Promise<GetBlocksResult> => {
  const url = new URL(`${window.origin}/api/v1/blocks`)
  if (limit) url.searchParams.set('limit', `${limit}`)
  if (maxId) url.searchParams.set('max_id', maxId)
  if (minId) url.searchParams.set('min_id', minId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { accounts: [], nextMaxId: null, prevMinId: null }
  }

  const linkHeader = response.headers.get('Link')
  return {
    accounts: (await response.json()) as MastodonAccount[],
    nextMaxId: getCursorFromLinkHeader(linkHeader, 'next'),
    prevMinId: getCursorFromLinkHeader(linkHeader, 'prev')
  }
}

export const revokeStatusQuote = async ({
  quotedStatusId,
  quotingStatusId
}: {
  quotedStatusId: string
  quotingStatusId: string
}): Promise<MastodonStatus | null> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(quotedStatusId)}/quotes/${toIdPathSegment(quotingStatusId)}/revoke`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  )
  if (response.status !== 200) return null
  return (await response.json()) as MastodonStatus
}

export const updateStatusInteractionPolicy = async ({
  statusId,
  quoteApprovalPolicy
}: {
  statusId: string
  quoteApprovalPolicy: QuoteApprovalPolicy
}): Promise<MastodonStatus | null> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/interaction_policy`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quote_approval_policy: quoteApprovalPolicy })
    }
  )
  if (response.status !== 200) return null
  return (await response.json()) as MastodonStatus
}

// The default quote-approval policy for new statuses (Mastodon 4.5
// posting:default:quote_policy). Falls back to 'public' on any failure.
export const getDefaultQuotePolicy = async (): Promise<QuoteApprovalPolicy> => {
  try {
    const response = await fetch('/api/v1/preferences', {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    if (response.status !== 200) return 'public'
    const preferences = (await response.json()) as Record<string, unknown>
    const policy = preferences['posting:default:quote_policy']
    return QuoteApprovalPolicy.safeParse(policy).success
      ? (policy as QuoteApprovalPolicy)
      : 'public'
  } catch {
    return 'public'
  }
}

interface MuteParams {
  targetActorId: string
  notifications?: boolean
}

export const mute = async ({
  targetActorId,
  notifications
}: MuteParams): Promise<MastodonRelationship | null> => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/mute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(notifications === undefined ? {} : { notifications })
  })
  if (response.status !== 200) return null
  return (await response.json()) as MastodonRelationship
}

export const unmute = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const encodedId = toIdPathSegment(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unmute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return null
  return (await response.json()) as MastodonRelationship
}

interface GetMutesParams {
  limit?: number
  maxId?: string
  minId?: string
}

interface GetMutesResult {
  accounts: MastodonAccount[]
  nextMaxId: string | null
  prevMinId: string | null
}

export const getMutes = async ({
  limit,
  maxId,
  minId
}: GetMutesParams = {}): Promise<GetMutesResult> => {
  const url = new URL(`${window.origin}/api/v1/mutes`)
  if (limit) url.searchParams.set('limit', `${limit}`)
  if (maxId) url.searchParams.set('max_id', maxId)
  if (minId) url.searchParams.set('min_id', minId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { accounts: [], nextMaxId: null, prevMinId: null }
  }

  const linkHeader = response.headers.get('Link')
  return {
    accounts: (await response.json()) as MastodonAccount[],
    nextMaxId: getCursorFromLinkHeader(linkHeader, 'next'),
    prevMinId: getCursorFromLinkHeader(linkHeader, 'prev')
  }
}

export interface GetBookmarksParams {
  limit?: number
  maxBookmarkId?: string
  minBookmarkId?: string
}

export interface GetBookmarksResult {
  statuses: Status[]
  nextMaxBookmarkId: string | null
  prevMinBookmarkId: string | null
}

export const getBookmarks = async ({
  limit,
  maxBookmarkId,
  minBookmarkId
}: GetBookmarksParams = {}): Promise<GetBookmarksResult> => {
  const url = new URL(`${window.origin}/api/v1/bookmarks`)
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (limit) url.searchParams.set('limit', `${limit}`)
  if (maxBookmarkId) url.searchParams.set('max_id', maxBookmarkId)
  if (minBookmarkId) url.searchParams.set('min_id', minBookmarkId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return {
      statuses: [],
      nextMaxBookmarkId: null,
      prevMinBookmarkId: null
    }
  }

  const data = (await response.json()) as Partial<GetBookmarksResult>
  return {
    statuses: data.statuses ?? [],
    nextMaxBookmarkId: data.nextMaxBookmarkId ?? null,
    prevMinBookmarkId: data.prevMinBookmarkId ?? null
  }
}

export interface GetFavouritesParams {
  limit?: number
  maxFavouriteId?: string
  minFavouriteId?: string
}

export interface GetFavouritesResult {
  statuses: Status[]
  nextMaxFavouriteId: string | null
  prevMinFavouriteId: string | null
}

export const getFavourites = async ({
  limit,
  maxFavouriteId,
  minFavouriteId
}: GetFavouritesParams = {}): Promise<GetFavouritesResult> => {
  const url = new URL(`${window.origin}/api/v1/favourites`)
  url.searchParams.set('format', TimelineFormat.enum.activities_next)
  if (limit) url.searchParams.set('limit', `${limit}`)
  if (maxFavouriteId) url.searchParams.set('max_id', maxFavouriteId)
  if (minFavouriteId) url.searchParams.set('min_id', minFavouriteId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return {
      statuses: [],
      nextMaxFavouriteId: null,
      prevMinFavouriteId: null
    }
  }

  const data = (await response.json()) as Partial<GetFavouritesResult>
  return {
    statuses: data.statuses ?? [],
    nextMaxFavouriteId: data.nextMaxFavouriteId ?? null,
    prevMinFavouriteId: data.prevMinFavouriteId ?? null
  }
}

interface GetTimelineParams {
  timeline: Timeline
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

interface GetTimelineResult {
  statuses: Status[]
  nextMaxStatusId: string | null
  prevMinStatusId: string | null
}

const MAX_EMPTY_TIMELINE_CONTINUATIONS = 2

const getTimelinePage = async ({
  timeline,
  minStatusId,
  maxStatusId,
  limit
}: GetTimelineParams): Promise<GetTimelineResult> => {
  const path = `/api/v1/timelines/${timeline}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (minStatusId) {
    url.searchParams.append('min_id', minStatusId)
  }
  if (maxStatusId) {
    url.searchParams.append('max_id', maxStatusId)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

export const getTimeline = async ({
  timeline,
  minStatusId,
  maxStatusId,
  limit
}: GetTimelineParams): Promise<GetTimelineResult> => {
  let result = await getTimelinePage({
    timeline,
    minStatusId,
    maxStatusId,
    limit
  })
  let currentMaxStatusId = result.nextMaxStatusId
  let continuations = 0

  while (
    result.statuses.length === 0 &&
    currentMaxStatusId &&
    continuations < MAX_EMPTY_TIMELINE_CONTINUATIONS
  ) {
    continuations++
    result = await getTimelinePage({
      timeline,
      minStatusId,
      maxStatusId: currentMaxStatusId,
      limit
    })
    currentMaxStatusId = result.nextMaxStatusId
  }

  return result
}

interface GetHashtagTimelineParams {
  tag: string
  maxStatusId?: string
}

interface GetHashtagTimelineResult {
  statuses: Status[]
  nextMaxStatusId: string | null
}

const getHashtagTimelinePage = async ({
  tag,
  maxStatusId
}: GetHashtagTimelineParams): Promise<GetHashtagTimelineResult> => {
  const path = `/api/v1/tags/${encodeURIComponent(tag)}?format=${TimelineFormat.enum.activities_next}`
  const url = new URL(`${window.origin}${path}`)
  if (maxStatusId) {
    url.searchParams.append('max_id', maxStatusId)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null
  }
}

export const getHashtagTimeline = async ({
  tag,
  maxStatusId
}: GetHashtagTimelineParams): Promise<GetHashtagTimelineResult> => {
  let result = await getHashtagTimelinePage({ tag, maxStatusId })
  let currentMaxStatusId = result.nextMaxStatusId
  let continuations = 0

  while (
    result.statuses.length === 0 &&
    currentMaxStatusId &&
    continuations < MAX_EMPTY_TIMELINE_CONTINUATIONS
  ) {
    continuations++
    result = await getHashtagTimelinePage({
      tag,
      maxStatusId: currentMaxStatusId
    })
    currentMaxStatusId = result.nextMaxStatusId
  }

  return result
}

interface GetActorStatusesParams {
  actorId: string
  pageUrl?: string | null
}

export interface GetActorStatusesResult {
  statuses: Status[]
  statusesCount: number
  nextPageUrl: string | null
  prevPageUrl: string | null
}

export const getActorStatuses = async ({
  actorId,
  pageUrl
}: GetActorStatusesParams): Promise<GetActorStatusesResult> => {
  const path = `/api/v1/accounts/${toIdPathSegment(actorId)}/remote-statuses`
  const url = new URL(`${window.origin}${path}`)
  if (pageUrl) {
    url.searchParams.append('page_url', pageUrl)
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) {
    throw new Error(`Failed to load actor statuses: ${response.status}`)
  }

  return (await response.json()) as GetActorStatusesResult
}

// Featured hashtags (https://docs.joinmastodon.org/methods/featured_tags/).
// The hashtags an account pins to its profile. Backed by the featured_tags
// endpoints; every call goes through here so components never call fetch().

// Throws on a non-OK response (rather than returning []) so the editor's load
// handler can tell "you have no featured tags" apart from "the request failed"
// and show its load-error UI. Featured tags are the critical data for the page;
// suggestions below stay best-effort.
export const getFeaturedTags = async (): Promise<FeaturedTag[]> => {
  const response = await fetch('/api/v1/featured_tags', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to load featured tags: ${response.status}`)
  }
  return (await response.json()) as FeaturedTag[]
}

export interface AddFeaturedTagResult {
  tag?: FeaturedTag
  error?: string
}

export const addFeaturedTag = async (
  name: string
): Promise<AddFeaturedTagResult> => {
  try {
    const response = await fetch('/api/v1/featured_tags', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    })
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        error?: string
      }
      return { error: data.error || 'Failed to feature hashtag' }
    }
    // Only treat it as a success when the body parses into a real entity —
    // a malformed 2xx body must not surface as a tag with missing fields.
    return { tag: (await response.json()) as FeaturedTag }
  } catch {
    // Network failure / unparseable body — surface as an error result rather
    // than rejecting, so callers can always settle their loading state.
    return { error: 'Failed to feature hashtag' }
  }
}

export const removeFeaturedTag = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(
      `/api/v1/featured_tags/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json'
        }
      }
    )
    return response.ok
  } catch {
    // Network failure — report as not-removed instead of rejecting.
    return false
  }
}

export const getFeaturedTagSuggestions = async (): Promise<Tag[]> => {
  const response = await fetch('/api/v1/featured_tags/suggestions', {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) return []
  return (await response.json()) as Tag[]
}

// Trends (https://docs.joinmastodon.org/methods/trends/). All three endpoints
// are read-scope and tolerate logged-out callers. Each helper throws on a
// non-OK response (mirroring getActorStatuses) so the Explore page can tell a
// real failure apart from "nothing is trending" and render its error state; the
// callers that prefer to stay quiet (the Search "Trending now" block) catch and
// hide instead.
const buildTrendsQuery = (limit?: number) =>
  typeof limit === 'number' ? `?limit=${limit}` : ''

const getTrends = async <T>(
  resource: 'tags' | 'statuses' | 'links',
  limit?: number
): Promise<T> => {
  const response = await fetch(
    `/api/v1/trends/${resource}${buildTrendsQuery(limit)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    }
  )
  if (!response.ok) {
    throw new Error(`Failed to load trending ${resource}: ${response.status}`)
  }
  // Every trends endpoint returns a JSON array; coerce anything else to an empty
  // list so callers can safely `.map`/`.length` over the result.
  const data = await response.json()
  return (Array.isArray(data) ? data : []) as T
}

export const getTrendingTags = (limit?: number): Promise<Tag[]> =>
  getTrends<Tag[]>('tags', limit)

// The /explore Posts tab renders trending statuses with the interactive timeline
// post component, which consumes the app's domain Status shape — so this asks the
// endpoint for `format=activities_next` (like the search client) rather than the
// default Mastodon serialization.
export const getTrendingStatuses = async (
  limit?: number
): Promise<Status[]> => {
  const params = new URLSearchParams({ format: 'activities_next' })
  if (typeof limit === 'number') params.set('limit', `${limit}`)
  const response = await fetch(`/api/v1/trends/statuses?${params.toString()}`, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (!response.ok) {
    throw new Error(`Failed to load trending statuses: ${response.status}`)
  }
  const data = await response.json()
  return Array.isArray(data) ? (data as Status[]) : []
}

export const getTrendingLinks = (limit?: number): Promise<PreviewCard[]> =>
  getTrends<PreviewCard[]>('links', limit)

interface DeleteSessionParams {
  token: string
}
export const deleteSession = async ({ token }: DeleteSessionParams) => {
  const path = `/api/v1/accounts/sessions/${token}`
  const response = await fetch(path, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

// Revoke every session for the account except the current device.
export const revokeOtherSessions = async (): Promise<boolean> => {
  const response = await fetch('/api/v1/accounts/sessions', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  return response.ok
}

interface RevokeConnectedAppParams {
  clientId: string
  actorId: string | null
}
// Revoke a connected app / SSO sign-in grant for the given actor.
export const revokeConnectedApp = async ({
  clientId,
  actorId
}: RevokeConnectedAppParams): Promise<boolean> => {
  const query = actorId ? `?actorId=${encodeURIComponent(actorId)}` : ''
  const response = await fetch(
    `/api/v1/accounts/connected-apps/${encodeURIComponent(clientId)}${query}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.ok
}

interface UploadMediaParams {
  media: File
  thumbnail?: File
  description?: string
}
export const uploadMedia = async ({
  media,
  thumbnail,
  description
}: UploadMediaParams) => {
  const path = '/api/v2/media'
  const form = new FormData()
  form.append('file', media)
  if (thumbnail) form.append('thumbnail', thumbnail)
  if (description) form.append('description', description)
  const response = await fetch(path, {
    method: 'POST',
    body: form
  })
  if (response.status !== 200) return null
  return response.json()
}

interface CreateUploadPresignedUrlParams {
  media: File
}
export const createUploadPresignedUrl = async ({
  media
}: CreateUploadPresignedUrlParams): Promise<{
  presigned: PresignedUrlOutput
} | null> => {
  const path = '/api/v1/medias/presigned'
  const checksum = await crypto.subtle.digest(
    'SHA-1',
    await media.arrayBuffer()
  )
  const hashArray = Array.from(new Uint8Array(checksum))
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

  const widthAndHeight = await getMediaWidthAndHeight(media)
  const body = {
    fileName: media.name,
    checksum: hashHex,
    contentType: media.type,
    size: media.size,
    ...widthAndHeight
  }
  const response = await fetch(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (response.status === 404) return null
  if (response.status !== 200) throw new Error('Failed to get presigned URL')
  return response.json()
}

interface UploadFileToPresignedUrlParams {
  presignedUrl: string
  media: File
  headers?: Record<string, string>
}

export const uploadFileToPresignedUrl = async ({
  presignedUrl,
  media,
  headers = {}
}: UploadFileToPresignedUrlParams) => {
  const response = await fetch(presignedUrl, {
    method: 'PUT',
    body: media,
    headers: { 'Content-Type': media.type, ...headers }
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to upload to storage: ${response.status} ${response.statusText}${errorText ? `. ${errorText}` : ''}`
    )
  }
  return response
}

export const completeUploadPresignedUrl = async ({
  mediaId
}: {
  mediaId: string
}): Promise<UploadedAttachment | null> => {
  const result = await completeUploadPresignedUrlRequest({ mediaId })
  return result.ok ? result.attachment : null
}

type CompleteUploadPresignedUrlResult =
  { ok: true; attachment: UploadedAttachment } | { ok: false; status: number }

const completeUploadPresignedUrlRequest = async ({
  mediaId
}: {
  mediaId: string
}): Promise<CompleteUploadPresignedUrlResult> => {
  const response = await fetch('/api/v1/medias/presigned', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ mediaId }),
    signal: AbortSignal.timeout(30_000)
  })
  if (response.status !== 200) {
    return { ok: false, status: response.status }
  }

  const result = (await response.json()) as {
    media: PresignedUrlOutput['saveFileOutput']
  }

  return {
    ok: true,
    attachment: {
      type: 'upload',
      id: result.media.id,
      mediaType: result.media.mime_type,
      url: result.media.url,
      posterUrl: result.media.preview_url ?? undefined,
      width: result.media.meta.original.width,
      height: result.media.meta.original.height,
      name: result.media.description ?? undefined
    }
  }
}

const isPermanentCompletionFailure = (status: number) =>
  status >= 400 && status < 500

const shouldCleanupAfterPermanentCompletionFailure = (status: number) =>
  status === 401 || status === 403

type CompleteUploadPresignedUrlWithRetryResult =
  | { completed: UploadedAttachment; shouldCleanup: false }
  | { completed: null; shouldCleanup: boolean }

const MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS = 3
const PRESIGNED_UPLOAD_COMPLETION_RETRY_DELAY_MS = 250

const completeUploadPresignedUrlWithRetry = async ({
  mediaId
}: {
  mediaId: string
}): Promise<CompleteUploadPresignedUrlWithRetryResult> => {
  for (
    let attempt = 1;
    attempt <= MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      const completed = await completeUploadPresignedUrlRequest({ mediaId })
      if (completed.ok) {
        return { completed: completed.attachment, shouldCleanup: false }
      }
      if (isPermanentCompletionFailure(completed.status)) {
        return {
          completed: null,
          shouldCleanup: shouldCleanupAfterPermanentCompletionFailure(
            completed.status
          )
        }
      }
    } catch {
      if (attempt === MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS) {
        return { completed: null, shouldCleanup: true }
      }
    }

    if (attempt < MAX_PRESIGNED_UPLOAD_COMPLETION_ATTEMPTS) {
      await waitFor(
        PRESIGNED_UPLOAD_COMPLETION_RETRY_DELAY_MS * 2 ** (attempt - 1)
      )
    }
  }

  return { completed: null, shouldCleanup: true }
}

const cleanupPendingUploadMedia = async (mediaId: string) => {
  await fetch(`/api/v1/accounts/media/${mediaId}`, {
    method: 'DELETE'
  }).catch(() => undefined)
}

export const uploadAttachment = async (
  file: File
): Promise<UploadedAttachment | null> => {
  const result = await createUploadPresignedUrl({ media: file })
  if (!result) {
    const media = await uploadMedia({ media: file })
    if (!media) return null
    return {
      type: 'upload',
      id: media.id,
      mediaType: media.mime_type,
      url: media.url,
      posterUrl: media.preview_url,
      width: media.meta.original.width,
      height: media.meta.original.height,
      name: media.description ?? undefined
    }
  }

  const { url: presignedUrl, saveFileOutput, headers } = result.presigned
  await uploadFileToPresignedUrl({ media: file, presignedUrl, headers })
  const completion = await completeUploadPresignedUrlWithRetry({
    mediaId: saveFileOutput.id
  })
  if (!completion.completed) {
    if (completion.shouldCleanup) {
      await cleanupPendingUploadMedia(saveFileOutput.id)
    }
    return null
  }

  return completion.completed
}

interface GetActorMediaParams {
  actorId: string
  maxCreatedAt?: number
  limit?: number
}
export const getActorMedia = async ({
  actorId,
  maxCreatedAt,
  limit = 25
}: GetActorMediaParams): Promise<Attachment[]> => {
  const encodedId = toIdPathSegment(actorId)
  const url = new URL(`${window.origin}/api/v1/accounts/${encodedId}/media`)
  if (maxCreatedAt) {
    url.searchParams.append('max_created_at', `${maxCreatedAt}`)
  }
  if (limit) {
    url.searchParams.append('limit', `${limit}`)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    }
  })
  if (response.status !== 200) return []
  return response.json()
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

export const retryFitnessProcessing = async (
  statusId: string
): Promise<{ statusId: string; retried: number }> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/retry-fitness`,
    { method: 'POST' }
  )

  if (!response.ok) {
    const errorDetails = await parseApiError(
      response,
      'Failed to retry fitness processing.'
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

export interface GetListTimelineParams {
  listId: string
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

// The list timeline does no server-side content filtering, so an empty page
// always carries a null cursor (end of list). That's unlike the home timeline,
// where filtered-out pages can still report a next cursor and need the
// empty-continuation loop in getTimeline — here a single page fetch suffices.
export const getListTimeline = async ({
  listId,
  minStatusId,
  maxStatusId,
  limit
}: GetListTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/timelines/list/${encodeURIComponent(
      listId
    )}?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

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

export interface GetCollectionTimelineParams {
  collectionId: string
  minStatusId?: string
  maxStatusId?: string
  limit?: number
}

// The owner's private collection feed (every member, owner visibility). Mirrors
// getListTimeline: a single page fetch, null cursor at the end.
export const getCollectionTimeline = async ({
  collectionId,
  minStatusId,
  maxStatusId,
  limit
}: GetCollectionTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/timelines/collection/${encodeURIComponent(
      collectionId
    )}?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

// The public, consent-gated projection of a collection's feed (approved members
// ∩ public posts). Unauthenticated-readable; used for the owner's "Public
// preview" toggle and the public collection page. Requests the internal format
// so the same <Posts> path renders it.
export const getCollectionFeed = async ({
  collectionId,
  minStatusId,
  maxStatusId,
  limit
}: GetCollectionTimelineParams): Promise<GetTimelineResult> => {
  const url = new URL(
    `${window.origin}/api/v1/collections/${encodeURIComponent(
      collectionId
    )}/feed?format=${TimelineFormat.enum.activities_next}`
  )
  if (minStatusId) url.searchParams.set('min_id', minStatusId)
  if (maxStatusId) url.searchParams.set('max_id', maxStatusId)
  if (limit) url.searchParams.set('limit', `${limit}`)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxStatusId: null, prevMinStatusId: null }
  }
  const data = await response.json()
  return {
    statuses: data.statuses as Status[],
    nextMaxStatusId: data.nextMaxStatusId ?? null,
    prevMinStatusId: data.prevMinStatusId ?? null
  }
}

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
