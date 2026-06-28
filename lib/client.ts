import { Duration } from '@/lib/components/post-box/poll-choices'
import type { AdminAnnouncement } from '@/lib/services/announcements/adminAnnouncement'
import { PresignedUrlOutput } from '@/lib/services/medias/types'
import type { AdminRule } from '@/lib/services/rules/adminRule'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { Timeline } from '@/lib/services/timelines/types'
import type { DirectConversation } from '@/lib/types/database/operations'
import {
  Attachment,
  PostBoxAttachment,
  UploadedAttachment
} from '@/lib/types/domain/attachment'
import type { AdminCustomEmoji } from '@/lib/types/domain/customEmoji'
import type { FilterAction, FilterContext } from '@/lib/types/domain/filter'
import { Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { Relationship as MastodonRelationship } from '@/lib/types/mastodon/account/relationship'
import type { Announcement } from '@/lib/types/mastodon/announcement'
import type { CollectionEntity } from '@/lib/types/mastodon/collection'
import type { CustomEmoji } from '@/lib/types/mastodon/customEmoji'
import type { FeaturedTag } from '@/lib/types/mastodon/featuredTag'
import type { Filter as MastodonFilter } from '@/lib/types/mastodon/filter'
import type { ListEntity } from '@/lib/types/mastodon/list'
import type { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import type { PreviewCard } from '@/lib/types/mastodon/previewCard'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { Tag } from '@/lib/types/mastodon/tag'
import type { Translation } from '@/lib/types/mastodon/translation'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { getMediaWidthAndHeight } from '@/lib/utils/getMediaWidthAndHeight'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { parseFetchResponseData } from '@/lib/utils/parseFetchResponseData'
import { idToUrl, urlToId } from '@/lib/utils/urlToId'
import { waitFor } from '@/lib/utils/waitFor'

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
    body: JSON.stringify({
      account_id: urlToId(targetActorId),
      ...(statusId ? { status_ids: [urlToId(statusId)] } : {}),
      ...(category ? { category } : {}),
      ...(comment ? { comment } : {})
    })
  })
  return response.status === 200
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

export interface TranslateStatusParams extends DefaultStatusParams {
  // Target language as an ISO 639-1 code. Omitted lets the server default to
  // its primary language.
  language?: string
}

/**
 * Translates a status using the Mastodon-compatible translate API. Returns the
 * Translation entity, or null when the server cannot translate it (no backend,
 * unsupported language, non-public status, or a backend failure).
 * @see https://docs.joinmastodon.org/methods/statuses/#translate
 */
export const translateStatus = async ({
  statusId,
  language
}: TranslateStatusParams): Promise<Translation | null> => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/translate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(language ? { lang: language } : {})
    }
  )
  if (response.status !== 200) return null
  return (await response.json()) as Translation
}

export interface TranslationCapability {
  // Whether a translation backend is configured on this server.
  enabled: boolean
  // The server's primary language (ISO 639-1); the default translation target.
  defaultLanguage: string | null
}

let translationCapabilityPromise: Promise<TranslationCapability> | null = null

/**
 * Reads the server's translation capability from `/api/v2/instance`, memoized
 * for the session so every post does not refetch it. Used by the Translate
 * control to avoid showing a dead button when no backend is configured.
 */
export const getTranslationCapability = (): Promise<TranslationCapability> => {
  if (!translationCapabilityPromise) {
    translationCapabilityPromise = fetch('/api/v2/instance')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => ({
        enabled: Boolean(data?.configuration?.translation?.enabled),
        defaultLanguage: Array.isArray(data?.languages)
          ? (data.languages[0] ?? null)
          : null
      }))
      .catch(() => ({ enabled: false, defaultLanguage: null }))
  }
  return translationCapabilityPromise
}

// A map of source language (ISO 639-1) → the target languages the configured
// backend can translate it into.
export type TranslationLanguages = Record<string, string[]>

let translationLanguagesPromise: Promise<TranslationLanguages> | null = null

/**
 * Reads the supported source→target language pairs from
 * `/api/v1/instance/translation_languages`, memoized for the session. Used to
 * populate the Translate control's target-language picker.
 * @see https://docs.joinmastodon.org/methods/instance/#translation_languages
 */
export const getTranslationLanguages = (): Promise<TranslationLanguages> => {
  if (!translationLanguagesPromise) {
    translationLanguagesPromise = fetch(
      '/api/v1/instance/translation_languages'
    )
      .then((response) => {
        // Throw on a non-OK status so an HTTP 5xx falls through to the catch
        // and clears the memo too — not just network rejections.
        if (!response.ok) {
          throw new Error('Failed to fetch translation languages')
        }
        return response.json()
      })
      .then(
        (data): TranslationLanguages =>
          data && typeof data === 'object' ? data : {}
      )
      .catch(() => {
        // Don't pin a transient failure for the whole session — clear the memo
        // so a later call can retry once the network/backend recovers.
        translationLanguagesPromise = null
        return {}
      })
  }
  return translationLanguagesPromise
}

/**
 * Favourites/likes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#favourite
 */
export const likeStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/favourite`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
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
  const response = await fetch(
    `/api/v1/statuses/${urlToId(statusId)}/unfavourite`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
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

interface SwitchActorParams {
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

interface MuteParams {
  targetActorId: string
  notifications?: boolean
}

export const mute = async ({
  targetActorId,
  notifications
}: MuteParams): Promise<MastodonRelationship | null> => {
  const encodedId = urlToId(targetActorId)
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
  const encodedId = urlToId(targetActorId)
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

export const getTrendingStatuses = (
  limit?: number
): Promise<MastodonStatus[]> => getTrends<MastodonStatus[]>('statuses', limit)

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
  elevationGainMeters: number | null
  activityType: string | null
  activityStartTime: number | null
  hasMapData: boolean
  description: string | null
  deviceManufacturer: string | null
  deviceName: string | null
  sourceUrl: string | null
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

    return (await response.json()) as FitnessGeneralSettingsResponse
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
  return { ok: response.ok, data }
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
  /** Total matching files to scan; progress denominator. 0 = not yet computed. */
  totalCount: number
  cursorOffset: number
  isPartial: boolean
  /** Opt-in public embed token; null/undefined when the heatmap is private. */
  shareToken?: string | null
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
  /** Total matching files to scan; progress denominator. 0 = not yet computed. */
  totalCount: number
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
  /** Serialized region scope (sorted `rect:` tokens). Omit/empty for world-wide. */
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

/**
 * Enables public sharing for a single route heatmap (identified by its
 * activity/period/region key) and returns its embed share token. Idempotent: a
 * heatmap that is already shared keeps its existing token.
 */
export const shareFitnessRouteHeatmap = async ({
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
  region?: string | null
}): Promise<string> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap/share`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_type: periodType,
        period_key: periodKey,
        ...(activityType ? { activity_type: activityType } : {}),
        ...(region ? { region } : {})
      })
    }
  )
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'heatmap share')
    )
  }
  const json = await response.json()
  return json.shareToken as string
}

/**
 * Disables public sharing (revokes the embed token) for a single route heatmap.
 */
export const unshareFitnessRouteHeatmap = async ({
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
  region?: string | null
}): Promise<void> => {
  const encodedId = urlToId(actorId)
  const url = new URL(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap/share`
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
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'heatmap share')
    )
  }
}

/**
 * Soft-deletes a single route heatmap (identified by its activity/period/region
 * key) from the actor's list. Used to remove a failed or unwanted heatmap.
 * Resolves to true when a row was removed.
 */
export const deleteFitnessRouteHeatmap = async ({
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
  region?: string | null
}): Promise<boolean> => {
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
    method: 'DELETE',
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) {
    throw new Error(
      await getRouteHeatmapResponseErrorMessage(response, 'route heatmap')
    )
  }
  const json = await response.json()
  return Boolean(json.deleted)
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

export interface FitnessRouteHeatmapRegionNameData {
  /** Serialized region scope (a single sorted `rect:` token). */
  region: string
  name: string
}

/** Loads the actor's saved region labels, keyed by serialized region scope. */
export const getFitnessRouteHeatmapRegionNames = async ({
  actorId
}: {
  actorId: string
}): Promise<FitnessRouteHeatmapRegionNameData[]> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap-region-names`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (!response.ok) return []
  try {
    const json = await response.json()
    return Array.isArray(json.names)
      ? (json.names as FitnessRouteHeatmapRegionNameData[])
      : []
  } catch {
    return []
  }
}

/**
 * Saves (or, with a blank/null name, clears) the label for one region. Resolves
 * to true when the server accepted the change.
 */
export const setFitnessRouteHeatmapRegionName = async ({
  actorId,
  region,
  name
}: {
  actorId: string
  region: string
  name: string | null
}): Promise<boolean> => {
  const encodedId = urlToId(actorId)
  const response = await fetch(
    `${window.origin}/api/v1/accounts/${encodedId}/fitness-route-heatmap-region-names`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region, name })
    }
  )
  return response.ok
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
      // accountIds are already Mastodon Account ids (the `urlToId`-encoded
      // form); the route decodes them with `idToUrl`, so pass them through.
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
  if (minStatusId) url.searchParams.set('min_id', urlToId(minStatusId))
  if (maxStatusId) url.searchParams.set('max_id', urlToId(maxStatusId))
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
// encoded). Account ids are Mastodon Account ids (the `urlToId`-encoded actor
// id); the routes decode them with `idToUrl`, so pass them through unchanged.

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
  return (await response.json()) as CollectionEntity
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
  return (await response.json()) as CollectionEntity
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
  // The acting member's own Mastodon Account id (the `urlToId`-encoded actor id).
  // The approve/revoke routes require it to resolve to the authenticated caller.
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
  if (minStatusId) url.searchParams.set('min_id', urlToId(minStatusId))
  if (maxStatusId) url.searchParams.set('max_id', urlToId(maxStatusId))
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
  if (minStatusId) url.searchParams.set('min_id', urlToId(minStatusId))
  if (maxStatusId) url.searchParams.set('max_id', urlToId(maxStatusId))
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
// they are not transformed with urlToId — they are still escaped with
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
