import { Duration } from '@/lib/services/statuses/pollDurations'
import { TimelineFormat } from '@/lib/services/timelines/const'
import { ActorProfile } from '@/lib/types/domain/actor'
import { Attachment, PostBoxAttachment } from '@/lib/types/domain/attachment'
import {
  QuoteApprovalPolicy,
  QuoteState,
  Status,
  StatusNote,
  StatusType,
  getOriginalStatus
} from '@/lib/types/domain/status'
import { Tag } from '@/lib/types/domain/tag'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import type { MediaAttachment } from '@/lib/types/mastodon/mediaAttachment'
import type { Status as MastodonStatus } from '@/lib/types/mastodon/status'
import type { StatusReaction as MastodonStatusReaction } from '@/lib/types/mastodon/statusReaction'
import type { Translation } from '@/lib/types/mastodon/translation'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { MastodonVisibility } from '@/lib/utils/getVisibility'
import { generatePublicId } from '@/lib/utils/publicId'
import { toIdPathSegment } from '@/lib/utils/urlToId'

import { parseApiError, throwApiError } from './http'

const parseTimestamp = (value: unknown, fallback: number) => {
  if (typeof value !== 'string') return fallback
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? fallback : timestamp
}

const getRecipientsFromVisibility = (
  visibility: MastodonVisibility,
  followersUrl: string
): { to: string[]; cc: string[] } => {
  switch (visibility) {
    case 'public':
      return {
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: followersUrl ? [followersUrl] : []
      }
    case 'unlisted':
      return {
        to: followersUrl ? [followersUrl] : [],
        cc: [ACTIVITY_STREAM_PUBLIC]
      }
    case 'private':
      return {
        to: followersUrl ? [followersUrl] : [],
        cc: []
      }
    case 'direct':
      return {
        to: [],
        cc: []
      }
  }
}

const getMediaTypeFromMastodonType = (type?: string): string => {
  switch (type) {
    case 'image':
      return 'image/jpeg'
    case 'gifv':
    case 'video':
      return 'video/mp4'
    case 'audio':
      return 'audio/mpeg'
    default:
      return 'application/octet-stream'
  }
}

const toCreatedNoteResult = (
  payload: unknown,
  params: {
    message: string
    contentWarning?: string
    replyStatus?: Status
    inReplyToId?: string
    quotedStatus?: Status
    quoteApprovalPolicy?: QuoteApprovalPolicy
    attachments: PostBoxAttachment[]
    visibility?: MastodonVisibility
    language?: string | null
  }
): { status: Status; attachments: Attachment[] } => {
  if (
    payload &&
    typeof payload === 'object' &&
    'status' in payload &&
    payload.status &&
    typeof payload.status === 'object'
  ) {
    const legacy = payload as { status: Status; attachments?: Attachment[] }
    return {
      status: legacy.status,
      attachments: Array.isArray(legacy.attachments)
        ? legacy.attachments
        : 'attachments' in legacy.status &&
            Array.isArray(legacy.status.attachments)
          ? legacy.status.attachments
          : []
    }
  }

  const mastodonStatus = payload as Partial<MastodonStatus>
  const now = Date.now()
  const createdAt = parseTimestamp(mastodonStatus.created_at, now)
  const updatedAt = mastodonStatus.edited_at
    ? parseTimestamp(mastodonStatus.edited_at, createdAt)
    : createdAt
  const statusId = mastodonStatus.uri || mastodonStatus.id || ''
  const publicId =
    mastodonStatus.id && mastodonStatus.id !== statusId
      ? mastodonStatus.id
      : (mastodonStatus.id ?? null)

  const account = mastodonStatus.account
  const actorUri = account?.uri || account?.url || ''
  let domain = ''
  let origin = ''
  if (actorUri) {
    try {
      const parsedUrl = new URL(actorUri)
      domain = parsedUrl.host
      origin = parsedUrl.origin
    } catch {
      domain = ''
      origin = ''
    }
  }
  const followersUrl = actorUri ? `${actorUri}/followers` : ''
  const actor: ActorProfile | null = account
    ? {
        id: actorUri || account.id,
        publicId:
          account.id && account.id !== actorUri
            ? account.id
            : (account.id ?? null),
        username: account.username ?? '',
        domain,
        ...(account.display_name ? { name: account.display_name } : {}),
        ...(account.note ? { summary: account.note } : {}),
        ...(account.avatar ? { iconUrl: account.avatar } : {}),
        ...(account.header ? { headerImageUrl: account.header } : {}),
        manuallyApprovesFollowers: Boolean(account.locked),
        tags: Array.isArray(account.emojis)
          ? account.emojis.map((emoji) => ({
              type: 'emoji' as const,
              name: `:${emoji.shortcode}:`,
              value: emoji.url
            }))
          : [],
        followersUrl,
        inboxUrl: actorUri ? `${actorUri}/inbox` : '',
        sharedInboxUrl: origin
          ? `${origin}/inbox`
          : actorUri
            ? `${actorUri}/inbox`
            : '',
        followingCount: account.following_count ?? 0,
        followersCount: account.followers_count ?? 0,
        statusCount: account.statuses_count ?? 0,
        lastStatusAt: account.last_status_at
          ? parseTimestamp(account.last_status_at, createdAt)
          : null,
        createdAt: parseTimestamp(account.created_at, createdAt)
      }
    : null

  const effectiveVisibility: MastodonVisibility =
    mastodonStatus.visibility ?? params.visibility ?? 'public'
  const { to, cc } = getRecipientsFromVisibility(
    effectiveVisibility,
    followersUrl
  )

  const mediaAttachments = Array.isArray(mastodonStatus.media_attachments)
    ? mastodonStatus.media_attachments
    : []
  const storedAttachments: Attachment[] = mediaAttachments.map(
    (mediaAttachment, index) => {
      const uploadedAttachment =
        index < params.attachments.length
          ? params.attachments[index]
          : undefined
      const meta = (
        'meta' in mediaAttachment ? mediaAttachment.meta : undefined
      ) as
        | {
            original?: { width?: number; height?: number }
            width?: number
            height?: number
          }
        | null
        | undefined
      const width =
        meta?.original?.width ?? meta?.width ?? uploadedAttachment?.width
      const height =
        meta?.original?.height ?? meta?.height ?? uploadedAttachment?.height
      const mediaType =
        uploadedAttachment?.mediaType ??
        (index >= params.attachments.length && mastodonStatus.fitness?.mimeType
          ? mastodonStatus.fitness.mimeType
          : getMediaTypeFromMastodonType(mediaAttachment.type))

      return {
        id: mediaAttachment.id,
        actorId: actor?.id ?? actorUri,
        statusId,
        type: 'Document',
        mediaType,
        url: mediaAttachment.url,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        blurhash: mediaAttachment.blurhash ?? null,
        thumbnailUrl: mediaAttachment.preview_url ?? null,
        name:
          mediaAttachment.description ??
          uploadedAttachment?.name ??
          mastodonStatus.fitness?.fileName ??
          '',
        mediaId: uploadedAttachment?.id ?? null,
        createdAt,
        updatedAt
      }
    }
  )

  const tags: Tag[] = [
    ...(Array.isArray(mastodonStatus.mentions)
      ? mastodonStatus.mentions.map((mention, index) => ({
          id: `${statusId}-mention-${index}`,
          statusId,
          type: 'mention' as const,
          name: `@${mention.acct || mention.username}`,
          value: mention.url,
          createdAt,
          updatedAt
        }))
      : []),
    ...(Array.isArray(mastodonStatus.tags)
      ? mastodonStatus.tags.map((tag, index) => ({
          id: `${statusId}-hashtag-${index}`,
          statusId,
          type: 'hashtag' as const,
          name: tag.name.startsWith('#') ? tag.name : `#${tag.name}`,
          value: tag.url,
          createdAt,
          updatedAt
        }))
      : []),
    ...(Array.isArray(mastodonStatus.emojis)
      ? mastodonStatus.emojis.map((emoji, index) => ({
          id: `${statusId}-emoji-${index}`,
          statusId,
          type: 'emoji' as const,
          name: `:${emoji.shortcode}:`,
          value: emoji.url,
          createdAt,
          updatedAt
        }))
      : [])
  ]

  const quoteEdge = (() => {
    if (mastodonStatus.quote) {
      const parsedState = QuoteState.safeParse(mastodonStatus.quote.state)
      const state: QuoteState = parsedState.success
        ? parsedState.data
        : 'accepted'
      const quotedTarget =
        'quoted_status' in mastodonStatus.quote &&
        mastodonStatus.quote.quoted_status
          ? (mastodonStatus.quote.quoted_status as Partial<MastodonStatus>)
          : null
      const quotedStatusId =
        params.quotedStatus?.id ??
        quotedTarget?.uri ??
        quotedTarget?.id ??
        ('quoted_status_id' in mastodonStatus.quote
          ? mastodonStatus.quote.quoted_status_id
          : null) ??
        ''
      if (quotedStatusId) {
        const quotedOriginal = params.quotedStatus
          ? getOriginalStatus(params.quotedStatus)
          : null
        return {
          quotedStatusId,
          quotedStatusUrl:
            quotedTarget?.url ?? quotedOriginal?.url ?? quotedStatusId,
          state
        }
      }
    }
    if (params.quotedStatus?.id) {
      const quotedOriginal = getOriginalStatus(params.quotedStatus)
      return {
        quotedStatusId: params.quotedStatus.id,
        quotedStatusUrl: quotedOriginal.url || params.quotedStatus.id,
        state: 'accepted' as const
      }
    }
    return undefined
  })()

  const resolvedQuotePolicy: QuoteApprovalPolicy | undefined = (() => {
    const automatic = mastodonStatus.quote_approval?.automatic
    if (Array.isArray(automatic)) {
      if (automatic.includes('public')) return 'public'
      if (automatic.includes('followers')) return 'followers'
      return 'nobody'
    }
    return params.quoteApprovalPolicy
  })()

  const spoilerText =
    mastodonStatus.spoiler_text !== undefined
      ? mastodonStatus.spoiler_text
      : (params.contentWarning ?? '')

  const status: StatusNote = {
    id: statusId,
    publicId,
    url: mastodonStatus.url || statusId,
    actorId: actor?.id ?? actorUri,
    actor,
    type: StatusType.enum.Note,
    text:
      typeof mastodonStatus.text === 'string'
        ? mastodonStatus.text
        : params.message,
    summary: spoilerText.trim().length > 0 ? spoilerText : null,
    sensitive: Boolean(mastodonStatus.sensitive),
    language: mastodonStatus.language ?? params.language ?? null,
    applicationName: mastodonStatus.application?.name ?? null,
    applicationWebsite: mastodonStatus.application?.website ?? null,
    to,
    cc,
    edits: [],
    reply:
      params.replyStatus?.id ??
      params.inReplyToId ??
      mastodonStatus.in_reply_to_id ??
      '',
    replies: [],
    totalReplies: mastodonStatus.replies_count ?? 0,
    actorAnnounceStatusId: null,
    isActorLiked: Boolean(mastodonStatus.favourited),
    isActorBookmarked: Boolean(mastodonStatus.bookmarked),
    isLocalActor: true,
    totalLikes: mastodonStatus.favourites_count ?? 0,
    totalShares: mastodonStatus.reblogs_count ?? 0,
    reactions:
      mastodonStatus.pleroma?.emoji_reactions ?? mastodonStatus.reactions ?? [],
    attachments: storedAttachments,
    tags,
    ...(mastodonStatus.fitness ? { fitness: mastodonStatus.fitness } : {}),
    ...(quoteEdge ? { quote: quoteEdge } : {}),
    ...(resolvedQuotePolicy
      ? { quoteApprovalPolicy: resolvedQuotePolicy }
      : {}),
    createdAt,
    updatedAt
  }

  return {
    status,
    attachments: storedAttachments
  }
}

export interface CreateNoteParams {
  message: string
  contentWarning?: string
  replyStatus?: Status
  inReplyToId?: string
  quotedStatus?: Status
  quoteApprovalPolicy?: QuoteApprovalPolicy
  attachments?: PostBoxAttachment[]
  fitnessFileId?: string
  visibility?: MastodonVisibility
  language?: string | null
  idempotencyKey?: string
}

export const createNote = async ({
  message,
  contentWarning,
  replyStatus,
  inReplyToId,
  quotedStatus,
  quoteApprovalPolicy,
  attachments = [],
  fitnessFileId,
  visibility,
  language,
  idempotencyKey
}: CreateNoteParams) => {
  if (
    message.trim().length === 0 &&
    attachments.length === 0 &&
    !fitnessFileId
  ) {
    throw new Error('Message or attachments must not be empty')
  }

  const resolvedReplyId = inReplyToId ?? replyStatus?.id
  const resolvedIdempotencyKey = idempotencyKey?.trim() || generatePublicId()
  const mediaIds = attachments.map((attachment) => attachment.id)

  const response = await fetch('/api/v1/statuses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': resolvedIdempotencyKey
    },
    body: JSON.stringify({
      status: message,
      ...(contentWarning !== undefined ? { spoiler_text: contentWarning } : {}),
      ...(resolvedReplyId ? { in_reply_to_id: resolvedReplyId } : {}),
      ...(quotedStatus?.id ? { quoted_status_id: quotedStatus.id } : {}),
      ...(quoteApprovalPolicy
        ? { quote_approval_policy: quoteApprovalPolicy }
        : {}),
      ...(mediaIds.length > 0 ? { media_ids: mediaIds } : {}),
      ...(fitnessFileId ? { fitness_file_id: fitnessFileId } : {}),
      ...(visibility ? { visibility } : {}),
      ...(language ? { language } : {})
    })
  })
  if (response.status !== 200) {
    await throwApiError(response, 'Fail to create a new note')
  }

  const json = await response.json()
  return toCreatedNoteResult(json, {
    message,
    contentWarning,
    replyStatus,
    inReplyToId: resolvedReplyId,
    quotedStatus,
    quoteApprovalPolicy,
    attachments,
    visibility,
    language
  })
}

export interface UpdateNoteParams {
  statusId: string
  message?: string
  contentWarning?: string
  attachments?: PostBoxAttachment[]
  /** Description (alt text) edits for attached media (Mastodon `media_attributes`). */
  mediaAttributes?: { id: string; description: string }[]
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

export const updateNote = async ({
  statusId,
  message,
  contentWarning,
  attachments,
  mediaAttributes
}: UpdateNoteParams): Promise<UpdateNoteResult> => {
  const hasMessageChange = message !== undefined
  const hasAttachmentChanges = attachments !== undefined
  const hasMediaAttributes = mediaAttributes !== undefined

  if (
    !hasMessageChange &&
    contentWarning === undefined &&
    !hasAttachmentChanges &&
    !hasMediaAttributes
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
          : {}),
        ...(mediaAttributes !== undefined
          ? {
              media_attributes: mediaAttributes.map((attribute) => ({
                id: attribute.id,
                description: attribute.description
              }))
            }
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
  inReplyToId?: string
  visibility?: MastodonVisibility
  language?: string | null
  idempotencyKey?: string
}

export const createPoll = async ({
  message,
  contentWarning,
  choices,
  durationInSeconds,
  pollType,
  replyStatus,
  inReplyToId,
  visibility,
  language,
  idempotencyKey
}: CreatePollParams) => {
  if (message.trim().length === 0 && choices.length === 0) {
    throw new Error('Message or choices must not be empty')
  }

  for (const choice of choices) {
    if (choice.trim().length === 0) {
      throw new Error('Choice text must not be empty')
    }
  }

  const resolvedReplyId = inReplyToId ?? replyStatus?.id
  const resolvedIdempotencyKey = idempotencyKey?.trim() || generatePublicId()

  const response = await fetch('/api/v1/statuses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': resolvedIdempotencyKey
    },
    body: JSON.stringify({
      status: message,
      ...(contentWarning !== undefined ? { spoiler_text: contentWarning } : {}),
      ...(resolvedReplyId ? { in_reply_to_id: resolvedReplyId } : {}),
      ...(visibility ? { visibility } : {}),
      ...(language ? { language } : {}),
      poll: {
        options: choices,
        expires_in: durationInSeconds,
        ...(pollType ? { multiple: pollType === 'anyOf' } : {})
      }
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

export const resetTranslationCapabilityForTesting = () => {
  translationCapabilityPromise = null
}

export const resetTranslationLanguagesForTesting = () => {
  translationLanguagesPromise = null
}

/**
 * Reads the server's translation capability from `/api/v2/instance`, memoized
 * for the session so every post does not refetch it. Used by the Translate
 * control to avoid showing a dead button when no backend is configured.
 */
export const getTranslationCapability = (): Promise<TranslationCapability> => {
  if (!translationCapabilityPromise) {
    translationCapabilityPromise = fetch('/api/v2/instance')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch instance capability')
        }
        return response.json()
      })
      .then((data) => ({
        enabled: Boolean(data?.configuration?.translation?.enabled),
        defaultLanguage: Array.isArray(data?.languages)
          ? (data.languages[0] ?? null)
          : null
      }))
      .catch(() => {
        // Don't pin a transient failure for the whole session — clear the memo
        // so a later call can retry once the network/backend recovers.
        translationCapabilityPromise = null
        return { enabled: false, defaultLanguage: null }
      })
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

export interface ReconcileStatusesParams {
  statusIds: string[]
  signal?: AbortSignal
}

export interface ReconcileStatusesResult {
  statuses: Status[]
  removedStatusIds: string[]
}

export async function reconcileCachedStatuses({
  statusIds,
  signal
}: ReconcileStatusesParams): Promise<ReconcileStatusesResult> {
  if (statusIds.length === 0) {
    return { statuses: [], removedStatusIds: [] }
  }

  const response = await fetch('/api/v1/statuses/reconcile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ statusIds: statusIds.slice(0, 80) }),
    signal
  })

  if (!response.ok) {
    await throwApiError(response, 'Failed to reconcile statuses')
  }

  const data = (await response.json()) as Partial<ReconcileStatusesResult>
  return {
    statuses: data.statuses ?? [],
    removedStatusIds: data.removedStatusIds ?? []
  }
}
