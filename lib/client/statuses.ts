import { Duration } from '@/lib/services/statuses/pollDurations'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import { QuoteApprovalPolicy, Status } from '@/lib/types/domain/status'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { StatusReaction as MastodonStatusReaction } from '@/lib/types/mastodon/statusReaction'
import type { Translation } from '@/lib/types/mastodon/translation'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { parseApiError, throwApiError } from './http'

export interface CreateNoteParams {
  message: string
  contentWarning?: string
  replyStatus?: Status
  quotedStatus?: Status
  quoteApprovalPolicy?: QuoteApprovalPolicy
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
}

export const createNote = async ({
  message,
  contentWarning,
  replyStatus,
  quotedStatus,
  quoteApprovalPolicy,
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
      quotedStatusId: quotedStatus?.id,
      quoteApprovalPolicy,
      visibility
    })
  })
  if (response.status !== 200) {
    await throwApiError(response, 'Fail to create a new note')
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

  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...(hasMessageChange ? { status: message } : {}),
        ...(contentWarning !== undefined
          ? { spoiler_text: contentWarning }
          : {}),
        ...(attachments !== undefined
          ? { media_ids: attachments.map((attachment) => attachment.id) }
          : {})
      })
    }
  )
  if (response.status !== 200) {
    await throwApiError(response, 'Fail to update the note')
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
    const response = await fetch(
      `/api/v1/statuses/${toIdPathSegment(statusId)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ visibility })
      }
    )
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
    await throwApiError(response, 'Fail to create a new poll')
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
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
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
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/reblog`,
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
 * Undoes a reblog/repost using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unreblog
 */
export const undoRepostStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/unreblog`,
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
    `/api/v1/statuses/${toIdPathSegment(statusId)}/translate`,
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

/**
 * Favourites/likes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#favourite
 */
export const likeStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/favourite`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
}

/**
 * The outcome of a reaction write. A 4xx that the user cannot retry away (the
 * per-actor cap, an emoji this instance rejects) carries the server's own
 * message so the row can say what actually went wrong instead of inviting a
 * retry that will always fail the same way.
 */
export type ReactionUpdateResult =
  | { ok: true; reactions: MastodonStatusReaction[] }
  | { ok: false; error?: string }

const toReactionUpdateResult = async (
  response: Response
): Promise<ReactionUpdateResult> => {
  if (!response.ok) {
    // Only a 422 the route deliberately marked with a `reason` carries copy
    // meant for a person. Every other 4xx answers with the bare HTTP reason
    // phrase ('Unauthorized', 'Not Found'), which must never be shown as if it
    // explained the failure — those fall through to the caller's own wording.
    if (response.status === 422) {
      const body = (await response.json().catch(() => null)) as {
        error?: unknown
        reason?: unknown
      } | null
      if (
        typeof body?.reason === 'string' &&
        typeof body.error === 'string' &&
        body.error.length > 0
      ) {
        return { ok: false, error: body.error }
      }
    }
    return { ok: false }
  }
  const status = (await response.json()) as MastodonStatus
  return {
    ok: true,
    reactions: status.pleroma?.emoji_reactions ?? status.reactions ?? []
  }
}

/**
 * Adds the current actor's emoji reaction to a status and returns the updated
 * reaction rollups, or a failure the caller can use to revert its optimistic
 * chip. `name` is a unicode emoji or a local custom-emoji shortcode.
 *
 * Uses the Pleroma/Akkoma dialect, which is the primary reaction surface (the
 * glitch-soc `react`/`unreact` routes are aliases over the same store). This is
 * an ecosystem extension, not core Mastodon API.
 * @see https://docs.akkoma.dev/stable/development/API/pleroma_api/
 */
export const reactToStatus = async ({
  statusId,
  name
}: DefaultStatusParams & { name: string }): Promise<ReactionUpdateResult> => {
  const response = await fetch(
    `/api/v1/pleroma/statuses/${toIdPathSegment(statusId)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return toReactionUpdateResult(response)
}

/**
 * Removes the current actor's emoji reaction from a status and returns the
 * updated rollups, or a failure the caller can use to revert.
 */
export const unreactFromStatus = async ({
  statusId,
  name
}: DefaultStatusParams & { name: string }): Promise<ReactionUpdateResult> => {
  const response = await fetch(
    `/api/v1/pleroma/statuses/${toIdPathSegment(statusId)}/reactions/${encodeURIComponent(name)}`,
    {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return toReactionUpdateResult(response)
}

export const bookmarkStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/bookmark`,
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
    `/api/v1/statuses/${toIdPathSegment(statusId)}/unbookmark`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
}

/**
 * Unfavourites/unlikes a status using Mastodon-compatible API
 * @see https://docs.joinmastodon.org/methods/statuses/#unfavourite
 */
export const undoLikeStatus = async ({ statusId }: DefaultStatusParams) => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}/unfavourite`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return response.status === 200
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
      .then((data): TranslationLanguages =>
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
  const path = `/api/v1/statuses/${toIdPathSegment(statusId)}/favourited_by${
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

export interface VotePollParams {
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

// Reads a specific cursor query param from a rel in the Link header. The quotes
// endpoint paginates with max_id (next) / since_id (prev) rather than min_id.
const getLinkCursor = (
  linkHeader: string | null,
  rel: string,
  param: string
) => {
  if (!linkHeader) return null
  const link = linkHeader
    .split(',')
    .map((item) => item.trim())
    .find((item) => item.endsWith(`rel="${rel}"`))
  const url = link?.match(/<([^>]+)>/)?.[1]
  if (!url) return null
  return new URL(url).searchParams.get(param)
}

export interface GetStatusQuotesParams {
  statusId: string
  limit?: number
  maxId?: string
  sinceId?: string
}

export interface GetStatusQuotesResult {
  statuses: MastodonStatus[]
  nextMaxId: string | null
  prevSinceId: string | null
}

export const getStatusQuotes = async ({
  statusId,
  limit,
  maxId,
  sinceId
}: GetStatusQuotesParams): Promise<GetStatusQuotesResult> => {
  const url = new URL(
    `${window.origin}/api/v1/statuses/${toIdPathSegment(statusId)}/quotes`
  )
  if (limit) url.searchParams.set('limit', `${limit}`)
  if (maxId) url.searchParams.set('max_id', maxId)
  if (sinceId) url.searchParams.set('since_id', sinceId)

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })
  if (response.status !== 200) {
    return { statuses: [], nextMaxId: null, prevSinceId: null }
  }

  const linkHeader = response.headers.get('Link')
  return {
    statuses: (await response.json()) as MastodonStatus[],
    nextMaxId: getLinkCursor(linkHeader, 'next', 'max_id'),
    prevSinceId: getLinkCursor(linkHeader, 'prev', 'since_id')
  }
}

// Fetch a single status by id (Mastodon shape). Returns null when the status is
// not found OR not readable by the caller (the route 404s in both cases), so a
// quote card never renders content the viewer isn't allowed to see.
export const getStatusById = async (
  statusId: string
): Promise<MastodonStatus | null> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(statusId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' }
    }
  )
  if (response.status !== 200) return null
  return (await response.json()) as MastodonStatus
}

export interface RevokeStatusQuoteParams {
  quotedStatusId: string
  quotingStatusId: string
}

export const revokeStatusQuote = async ({
  quotedStatusId,
  quotingStatusId
}: RevokeStatusQuoteParams): Promise<MastodonStatus | null> => {
  const response = await fetch(
    `/api/v1/statuses/${toIdPathSegment(quotedStatusId)}/quotes/${toIdPathSegment(quotingStatusId)}/revoke`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  )
  if (response.status !== 200) return null
  return (await response.json()) as MastodonStatus
}

export interface UpdateStatusInteractionPolicyParams {
  statusId: string
  quoteApprovalPolicy: QuoteApprovalPolicy
}

export const updateStatusInteractionPolicy = async ({
  statusId,
  quoteApprovalPolicy
}: UpdateStatusInteractionPolicyParams): Promise<MastodonStatus | null> => {
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
