import { Duration } from '@/lib/components/post-box/poll-choices'
import { PresignedUrlOutput } from '@/lib/services/medias/types'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import type { DirectConversation } from '@/lib/types/database/operations'
import {
  Attachment,
  PostBoxAttachment,
  UploadedAttachment
} from '@/lib/types/domain/attachment'
import { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import type { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { parseFetchResponseData } from '@/lib/utils/parseFetchResponseData'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'

export interface CreateNoteParams {
  message: string
  contentWarning?: string
  replyStatus?: Status
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
}
export const createNote = async ({
  message,
  contentWarning,
  replyStatus,
  attachments = [],
  fitnessFileId,
  visibility
}: CreateNoteParams) => {
  if (
    message.trim().length === 0 &&
    attachments.length === 0 &&
    !fitnessFileId
  ) {
    throw new Error('Message or attachments must not be empty')
  }

  const response = await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'note',
      replyStatus,
      message,
      contentWarning,
      attachments,
      fitnessFileId,
      visibility
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to create a new note')
  }

  const json = await response.json()
  return {
    status: json.status as Status,
    attachments: json.attachments as Attachment[]
  }
}

export interface UpdateNoteParams {
  statusId: string
  message?: string
  contentWarning?: string
  attachments?: PostBoxAttachment[]
}
export interface UpdateNoteResult {
  content: string
  spoilerText: string
  mediaAttachments: MediaAttachment[]
  status: {
    id: string
    text: string | null
    createdAt: number
    updatedAt?: number
    reply: string
  }
}

const parseTimestamp = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? fallback : timestamp
}

export const updateNote = async ({
  statusId,
  message,
  contentWarning,
  attachments
}: UpdateNoteParams): Promise<UpdateNoteResult> => {
  const hasMessageChange = message !== undefined
  const hasAttachmentChanges = attachments !== undefined

  if (
    !hasMessageChange &&
    contentWarning === undefined &&
    !hasAttachmentChanges
  ) {
    throw new Error('Message, content warning, or attachments must be provided')
  }

  const encodedStatusId = statusId.startsWith('http')
    ? urlToId(statusId)
    : statusId
  const response = await fetch(`/api/v1/statuses/${encodedStatusId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...(hasMessageChange ? { status: message } : {}),
      ...(contentWarning !== undefined ? { spoiler_text: contentWarning } : {}),
      ...(attachments !== undefined
        ? { media_ids: attachments.map((attachment) => attachment.id) }
        : {})
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to update the note')
  }

  const mastodonStatus = await response.json()
  const createdAt = parseTimestamp(mastodonStatus.created_at, Date.now())
  return {
    content: mastodonStatus.content,
    spoilerText: mastodonStatus.spoiler_text ?? '',
    mediaAttachments: Array.isArray(mastodonStatus.media_attachments)
      ? mastodonStatus.media_attachments
      : [],
    status: {
      id: mastodonStatus.uri ?? mastodonStatus.id,
      text: mastodonStatus.text ?? null,
      createdAt,
      updatedAt: mastodonStatus.edited_at
        ? parseTimestamp(mastodonStatus.edited_at, createdAt)
        : undefined,
      reply: mastodonStatus.in_reply_to_id || ''
    }
  }
}

export interface UpdateStatusVisibilityParams {
  statusId: string
  visibility: MastodonVisibility
}

export const updateStatusVisibility = async ({
  statusId,
  visibility
}: UpdateStatusVisibilityParams): Promise<boolean> => {
  try {
    const response = await fetch(`/api/v1/statuses/${urlToId(statusId)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ visibility })
    })
    return response.status === 200
  } catch {
    return false
  }
}

export interface CreatePollParams {
  message: string
  contentWarning?: string
  choices: string[]
  durationInSeconds: Duration
  pollType?: 'oneOf' | 'anyOf'
  replyStatus?: Status
  visibility?: MastodonVisibility
}

export const createPoll = async ({
  message,
  contentWarning,
  choices,
  durationInSeconds,
  pollType,
  replyStatus,
  visibility
}: CreatePollParams) => {
  if (message.trim().length === 0 && choices.length === 0) {
    throw new Error('Message or choices must not be empty')
  }

  for (const choice of choices) {
    if (choice.trim().length === 0) {
      throw new Error('Choice text must not be empty')
    }
  }

  const response = await fetch('/api/v1/accounts/outbox', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      type: 'poll',
      replyStatus,
      message,
      contentWarning,
      durationInSeconds,
      pollType,
      choices,
      visibility
    })
  })
  if (response.status !== 200) {
    throw new Error('Fail to create a new poll')
  }
}

export interface DefaultStatusParams {
  statusId: string
}

/**
 * Deletes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#delete
 */
export const deleteStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(`/api/v1/statuses/${urlToId(statusId)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) {
    return false
  }

  return true
}

/**
 * Reblogs/reposts a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#boost
 */
export const repostStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(`/api/v1/statuses/${urlToId(statusId)}/reblog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return null
  const mastodonStatus = await response.json()
  return { statusId: mastodonStatus.id }
}

/**
 * Undoes a reblog/repost using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unreblog
 */
export const undoRepostStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/unreblog`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  if (response.status !== 200) return null
  const mastodonStatus = await response.json()
  return { statusId: mastodonStatus.id }
}

/**
 * Favourites/likes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#favourite
 */
export const likeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch(`/api/v1/statuses/${urlToId(statusId)}/favourite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

export const bookmarkStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/bookmark`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
}

export interface GetStatusFavouritedByParams extends DefaultStatusParams {
  limit?: number
  offset?: number
}

export interface StatusFavouritedByResult {
  accounts: MastodonAccount[]
  total: number
  limit: number
  offset: number
}

export const getStatusFavouritedBy = async ({
  statusId,
  limit,
  offset = 0
}: GetStatusFavouritedByParams): Promise<StatusFavouritedByResult> => {
  const query = new URLSearchParams()
  if (typeof limit === 'number') {
    query.append('limit', `${limit}`)
  }
  if (offset > 0) {
    query.append('offset', `${offset}`)
  }
  const path = `/api/v1/statuses/${urlToId(statusId)}/favourited_by${
    query.toString().length > 0 ? `?${query.toString()}` : ''
  }`

  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' }
  })

  if (response.status !== 200) {
    return {
      accounts: [],
      total: 0,
      limit: limit ?? 0,
      offset
    }
  }

  const parseHeaderNumber = (value: string | null, fallback: number) => {
    const parsed = parseInt(value ?? '', 10)
    return Number.isNaN(parsed) ? fallback : parsed
  }

  const accounts = (
    (await response.json()) as (MastodonAccount | null)[]
  ).filter((account): account is MastodonAccount => Boolean(account))
  const resolvedOffset = parseHeaderNumber(
    response.headers.get('X-Offset'),
    offset
  )
  const resolvedTotal = parseHeaderNumber(
    response.headers.get('X-Total-Count'),
    accounts.length
  )
  const resolvedLimit = parseHeaderNumber(
    response.headers.get('X-Limit'),
    limit ?? accounts.length
  )

  return {
    accounts,
    total: resolvedTotal,
    limit: resolvedLimit,
    offset: resolvedOffset
  }
}

/**
 * Unfavourites/unlikes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unfavourite
 */
export const undoLikeStatus = async ({ statusId }: DefaultStatusParams) => {
  await fetch(`/api/v1/statuses/${urlToId(statusId)}/unfavourite`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

export const undoBookmarkStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/unbookmark`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
}

interface VotePollParams {
  statusId: string
  choices: number[]
}

export const votePoll = async ({ statusId, choices }: VotePollParams) => {
  const response = await fetch('/api/v1/accounts/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusId, choices })
  })
  if (response.status !== 200) {
    throw new Error('Failed to vote')
  }
  return response.json()
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
  const encodedId = urlToId(targetActorId)
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodedId}`,
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
  const encodedId = urlToId(targetActorId)
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
  const encodedId = urlToId(targetActorId)
  const response = await fetch(`/api/v1/accounts/${encodedId}/unfollow`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
  if (response.status !== 200) return false
  return true
}

export const getRelationship = async ({
  targetActorId
}: FollowParams): Promise<MastodonRelationship | null> => {
  const encodedId = urlToId(targetActorId)
  const response = await fetch(
    `/api/v1/accounts/relationships?id[]=${encodedId}`,
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
  const encodedId = urlToId(targetActorId)
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
  const encodedId = urlToId(targetActorId)
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
    url.searchParams.append('min_id', urlToId(minStatusId))
  }
  if (maxStatusId) {
    url.searchParams.append('max_id', urlToId(maxStatusId))
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
    url.searchParams.append('max_id', urlToId(maxStatusId))
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
  const path = `/api/v1/accounts/${urlToId(actorId)}/remote-statuses`
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
  | { ok: true; attachment: UploadedAttachment }
  | { ok: false; status: number }

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
      name: result.media.description
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

const wait = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

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
      await wait(
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
      name: file.name
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

  return {
    ...completion.completed,
    name: file.name
  }
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
  const encodedId = urlToId(actorId)
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

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

const parseApiError = async (
  response: Response,
  fallbackMessage: string
): Promise<string> => {
  const errorText = await response.text().catch(() => response.statusText)

  if (!errorText) {
    return response.statusText || fallbackMessage
  }

  try {
    const parsedError = JSON.parse(errorText) as {
      status?: string
      message?: string
      error?: string
    }
    return (
      parsedError.status ||
      parsedError.message ||
      parsedError.error ||
      errorText
    )
  } catch {
    // Use raw text if error body is not JSON.
    return errorText
  }
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

  const response = await fetch('/api/v1/settings/fitness/import', {
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
  const response = await fetch(
    '/api/v1/settings/fitness/strava/archive/presigned',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: archive.name,
        contentType: archive.type || 'application/zip',
        size: archive.size
      })
    }
  )
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
      const response = await fetch('/api/v1/settings/fitness/strava/archive', {
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

  const response = await fetch('/api/v1/settings/fitness/strava/archive', {
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
    const response = await fetch('/api/v1/settings/fitness/strava/archive', {
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
  const response = await fetch('/api/v1/settings/fitness/strava/archive', {
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
  const response = await fetch('/api/v1/settings/fitness/strava/archive', {
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
    `/api/v1/settings/fitness/import/${encodeURIComponent(batchId)}`,
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
    `/api/v1/settings/fitness/import/${encodeURIComponent(batchId)}`,
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

export const retryFitnessProcessing = async (
  statusId: string
): Promise<{ statusId: string; retried: number }> => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/retry-fitness`,
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
  const encodedId = urlToId(actorId)
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

// Fitness Route Heatmap

export interface FitnessRouteHeatmapPoint {
  lat: number
  lng: number
}

export interface FitnessRouteHeatmapSegment {
  isHiddenByPrivacy?: boolean
  points: FitnessRouteHeatmapPoint[]
}

export interface FitnessRouteHeatmapBounds {
  minLat: number
  maxLat: number
  minLng: number
  maxLng: number
}

export interface FitnessRouteHeatmapData {
  id: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  status: string
  bounds?: FitnessRouteHeatmapBounds | null
  segments: FitnessRouteHeatmapSegment[]
  activityCount: number
  pointCount: number
  cursorOffset: number
  isPartial: boolean
  error?: string | null
  createdAt: number
  updatedAt: number
}

export interface FitnessRouteHeatmapSummaryData {
  id: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  status: string
  activityCount: number
  pointCount: number
  cursorOffset: number
  isPartial: boolean
  error?: string | null
  createdAt: number
  updatedAt: number
}

export interface FitnessCalendarDay {
  date: string
  count: number
  totalDistanceMeters: number
  totalDurationSeconds: number
}

const getRouteHeatmapResponseErrorMessage = async (
  response: Response,
  label: string
) => {
  const data = await parseFetchResponseData(response)
  const detail =
    typeof data.message === 'string'
      ? data.message
      : typeof data.error === 'string'
        ? data.error
        : response.statusText

  return `Failed to load ${label} (${response.status})${detail ? `: ${detail}` : '.'}`
}

/**
 * Loads the focused route-heatmap cache. Non-OK responses are thrown instead of
 * coerced to null so the UI can distinguish a failed read from a cache miss.
 */
export const getFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  /** Serialized sorted region IDs, e.g. "netherlands,singapore". Omit for world-wide. */
  region?: string | null
}): Promise<FitnessRouteHeatmapData | null> => {
  const encodedId = urlToId(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`
  )
  url.searchParams.append('period_type', periodType)
  url.searchParams.append('period_key', periodKey)
  if (activityType) {
    url.searchParams.append('activity_type', activityType)
  }
  if (region) {
    url.searchParams.append('region', region)
  }
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap')
    )
  }
  try {
    const json = await response.json()
    if (json && typeof json === 'object' && 'heatmap' in json) {
      return json.heatmap as FitnessRouteHeatmapData | null
    }
    return json as FitnessRouteHeatmapData | null
  } catch {
    return null
  }
}

export const triggerFitnessRouteHeatmap = async ({
  actorId,
  activityType,
  periodType,
  periodKey,
  region,
  retry
}: {
  actorId: string
  activityType?: string
  periodType: string
  periodKey: string
  region?: string | null
  retry?: boolean
}): Promise<boolean> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_type: periodType,
        period_key: periodKey,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(region ? { region } : {}),
        ...(retry ? { retry } : {})
      })
    }
  )
  return response.ok
}

export const getFitnessRouteHeatmaps = async ({
  actorId
}: {
  actorId: string
}): Promise<FitnessRouteHeatmapSummaryData[]> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmaps`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmaps')
    )
  }
  const json = await response.json()
  return json.heatmaps as FitnessRouteHeatmapSummaryData[]
}

export const clearFitnessRouteHeatmaps = async ({
  actorId
}: {
  actorId: string
}): Promise<number> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmaps`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmaps')
    )
  }
  const json = await response.json()
  return typeof json.deleted === 'number' ? json.deleted : 0
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
  const encodedId = urlToId(actorId)
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

export const getDistinctFitnessActivityTypes = async ({
  actorId
}: {
  actorId: string
}): Promise<string[]> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `/api/v1/accounts/${encodedId}/fitness-activity-types`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
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
  if (limit) url.searchParams.set('limit', `${limit}`)
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
  if (maxStatusId) url.searchParams.set('max_id', urlToId(maxStatusId))
  if (minStatusId) url.searchParams.set('min_id', urlToId(minStatusId))
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

export const searchAccounts = async ({
  q,
  limit = 5,
  resolve = true
}: {
  q: string
  limit?: number
  resolve?: boolean
}): Promise<MastodonAccount[]> => {
  const url = new URL(`${window.origin}/api/v1/accounts/search`)
  url.searchParams.set('q', q)
  url.searchParams.set('limit', `${limit}`)
  url.searchParams.set('resolve', resolve ? 'true' : 'false')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
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
  const accountActorId = normalizeActorId(idToUrl(account.id))
  if (!accountActorId) return false
  return replyParticipantIds.has(accountActorId)
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
    body: JSON.stringify({
      status,
      visibility: 'direct',
      ...(replyStatus ? { in_reply_to_id: urlToId(replyStatus.id) } : {})
    })
  })
  if (!response.ok) {
    throw new Error('Failed to send message')
  }
  return (await response.json()) as CreateDirectMessageResult
}
