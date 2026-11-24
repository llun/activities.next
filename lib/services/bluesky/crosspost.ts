// Cross-posting a local public post to the author's linked Bluesky account.
// The record is written to the user's PDS; the text, facets, images and link
// card are built from the local status only. A cross-post is claimed once
// (bluesky_crossposts) and its uri is recorded before anything after
// createRecord can throw, so a retry never posts it twice.
import type { Database } from '@/lib/database/types'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import { getServedHostConfig } from '@/lib/services/domains/servedDomainSnapshot'
import { getMediaPathFromFileUrl } from '@/lib/services/medias/mediaFileUrl'
import { readStoredImage } from '@/lib/services/medias/readStoredMedia'
import { getQueue } from '@/lib/services/queue'
import type { Actor } from '@/lib/types/domain/actor'
import { isFitnessAttachment } from '@/lib/types/domain/attachment'
import {
  type Status,
  type StatusNote,
  type StatusPoll,
  StatusType,
  isBlueskyStatus
} from '@/lib/types/domain/status'
import { getHashFromString } from '@/lib/utils/getHashFromString'
import { getStatusVisibility } from '@/lib/utils/getVisibility'
import { logger } from '@/lib/utils/logger'
import { safeImageFetch } from '@/lib/utils/safeImageDownload'
import { readResponseArrayBufferWithLimit } from '@/lib/utils/streamLimit'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { BlueskyActionError } from './actionErrors'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  BlueskyUnexpectedAnswerError,
  getBlueskyAgent
} from './agent'
import { getPublicPosts } from './appview'
import { BlueskyLockTimeoutError, createBlueskyLock } from './client'
import {
  BlueskyImageTooLargeError,
  buildCrosspostText,
  fitImageForBluesky,
  markdownToBlueskyPlainText
} from './crosspostText'
import { BLUESKY_NOT_ALLOWED_MESSAGE, isBlueskyAllowed } from './policy'
import { optionalString, parseAtUri, parseBlueskyPostView } from './records'
import { buildBlueskyFacets, normalizeBlueskyMentions } from './richText'

const POST_COLLECTION = 'app.bsky.feed.post'
const CID_V1_BASE32_PATTERN = /^b[a-z2-7]{50,}$/
const MAX_IMAGES = 4
const LINK_PREVIEW_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export const BLUESKY_CROSSPOST_LOCK_PREFIX = 'bluesky-crosspost:'
export const BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE =
  'Link a Bluesky account in Settings › Other networks to cross-post.'
export const BLUESKY_CROSSPOST_FAILED_MESSAGE =
  'Bluesky did not accept the post.'
export const BLUESKY_CROSSPOST_IMAGE_TOO_LARGE_MESSAGE =
  'An image is too large for Bluesky.'
export const BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE =
  'Bluesky ended this session.'

type StrongRef = { uri: string; cid: string }

type PostStatus = StatusNote | StatusPoll

// A boost is never cross-posted: only the author's own public Note or Poll.
const isCrosspostableStatus = (status: Status): status is PostStatus =>
  status.type !== StatusType.enum.Announce &&
  status.isLocalActor &&
  !isBlueskyStatus(status) &&
  getStatusVisibility(status) === 'public'

const isCrosspostImage = (attachment: PostStatus['attachments'][number]) => {
  if (isFitnessAttachment(attachment)) return false
  if (attachment.playbackType === 'gifv') return false
  return attachment.mediaType.toLowerCase().startsWith('image/')
}

const readReplyRoot = async (parent: StrongRef): Promise<StrongRef | null> => {
  const views = await getPublicPosts([parent.uri])
  for (const value of views) {
    const parsed = parseBlueskyPostView(value)
    if (!parsed || parsed.uri !== parent.uri) continue
    const reply = parsed.record.reply
    if (!isRecord(reply) || !isRecord(reply.root)) return null
    const uri = optionalString(reply.root.uri)
    const cid = optionalString(reply.root.cid)
    if (!uri || !cid) return null
    if (parseAtUri(uri)?.collection !== POST_COLLECTION) return null
    return { uri, cid }
  }
  return null
}

// The reply refs of a cross-posted reply, `'retry'` while the parent's own
// cross-post is still pending, or null when the reply must not be cross-posted
// (its parent is not the author's own cross-posted post).
const resolveReplyRefs = async (
  database: Database,
  status: PostStatus
): Promise<{ root: StrongRef; parent: StrongRef } | 'retry' | null> => {
  if (!status.reply) return null
  const parent = await database.getStatus({
    statusId: status.reply,
    withReplies: false
  })
  if (!parent || parent.actorId !== status.actorId) return null
  const parentCrosspost = await database.getBlueskyCrosspost({
    statusId: parent.id
  })
  if (!parentCrosspost) return null
  if (parentCrosspost.state === 'pending') return 'retry'
  if (
    parentCrosspost.state !== 'posted' ||
    !parentCrosspost.uri ||
    !parentCrosspost.cid
  ) {
    return null
  }
  const parentRef: StrongRef = {
    uri: parentCrosspost.uri,
    cid: parentCrosspost.cid
  }
  const root = (await readReplyRoot(parentRef)) ?? parentRef
  return { root, parent: parentRef }
}

const uploadImage = async (
  database: Database,
  agent: BlueskyAgent,
  url: string,
  alt: string
) => {
  const path = getMediaPathFromFileUrl(url, getServedHostConfig())
  const stored = path ? await readStoredImage(database, path) : null
  if (!stored) return null
  const fitted = await fitImageForBluesky(stored.buffer, stored.mimeType)
  const blob = await agent.uploadBlob(fitted.bytes, fitted.mimeType)
  return {
    image: blob,
    alt,
    aspectRatio: { width: fitted.width, height: fitted.height }
  }
}

const uploadLinkPreviewThumb = async (
  agent: BlueskyAgent,
  imageUrl: string | null | undefined
) => {
  if (!imageUrl) return null
  try {
    const response = await safeImageFetch(imageUrl)
    if (!response?.ok) return null
    const bytes = await readResponseArrayBufferWithLimit(
      response,
      LINK_PREVIEW_IMAGE_MAX_BYTES,
      'Link preview image'
    )
    const fitted = await fitImageForBluesky(
      Buffer.from(bytes),
      response.headers.get('content-type') ?? 'image/jpeg'
    )
    return await agent.uploadBlob(fitted.bytes, fitted.mimeType)
  } catch (error) {
    logger.warn({
      message: 'Could not attach a link preview image to a Bluesky cross-post',
      err: toLoggableError(error)
    })
    return null
  }
}

const buildRecord = async (
  database: Database,
  agent: BlueskyAgent,
  status: PostStatus,
  replyRefs: { root: StrongRef; parent: StrongRef } | null
): Promise<Record<string, unknown>> => {
  const fullUrl = status.url
  const summary = status.summary?.trim()
  const hasContentWarning = Boolean(summary)

  const imageAttachments = status.attachments.filter(isCrosspostImage)
  let hasDroppedMedia =
    imageAttachments.length > MAX_IMAGES ||
    status.attachments.length > imageAttachments.length

  const images: Array<{
    image: unknown
    alt: string
    aspectRatio: { width: number; height: number }
  }> = []
  if (!hasContentWarning) {
    for (const attachment of imageAttachments.slice(0, MAX_IMAGES)) {
      const uploaded = await uploadImage(
        database,
        agent,
        attachment.url,
        attachment.name ?? ''
      )
      if (!uploaded) {
        hasDroppedMedia = true
        continue
      }
      images.push(uploaded)
    }
  }

  // A quote of a Bluesky post embeds the record; a quote of a fediverse post
  // only has a URL to append to the text.
  let quotedBlueskyRecord: StrongRef | null = null
  let fediverseQuoteUrl: string | null = null
  if (status.quote) {
    const quotedRecord = await database.getBlueskyRecordByStatusId({
      statusId: status.quote.quotedStatusId
    })
    if (quotedRecord) {
      quotedBlueskyRecord = { uri: quotedRecord.uri, cid: quotedRecord.cid }
    } else {
      const quotedStatus = await database.getStatus({
        statusId: status.quote.quotedStatusId,
        withReplies: false
      })
      fediverseQuoteUrl =
        (quotedStatus && quotedStatus.type !== StatusType.enum.Announce
          ? quotedStatus.url
          : null) ??
        status.quote.quotedStatusUrl ??
        null
    }
  }

  // A content warning is all the copy says; the text and media stay here.
  // A poll links to where it can be voted on.
  let body = hasContentWarning
    ? (summary ?? '')
    : markdownToBlueskyPlainText(status.text)
  if (!hasContentWarning && fediverseQuoteUrl) {
    body = `${body}\n\n${fediverseQuoteUrl}`
  }
  const isPoll = status.type === StatusType.enum.Poll
  const { text: cutText } = buildCrosspostText({
    text: normalizeBlueskyMentions(body),
    fullUrl: isPoll && !hasContentWarning ? `Vote here: ${fullUrl}` : fullUrl,
    forceLink: hasContentWarning || isPoll || hasDroppedMedia
  })
  // An empty body (an image-only post) leaves the link's blank lines in front.
  const finalText = cutText.trim()
  const facets = await buildBlueskyFacets(finalText)

  let embed: Record<string, unknown> | undefined
  if (quotedBlueskyRecord) {
    embed =
      images.length > 0
        ? {
            $type: 'app.bsky.embed.recordWithMedia',
            record: { record: quotedBlueskyRecord },
            media: { $type: 'app.bsky.embed.images', images }
          }
        : {
            $type: 'app.bsky.embed.record',
            record: quotedBlueskyRecord
          }
  } else if (images.length > 0) {
    embed = { $type: 'app.bsky.embed.images', images }
  } else if (!hasContentWarning) {
    // The card only when this server already fetched it for the post.
    const preview = status.linkPreview
    if (preview?.title) {
      const thumb = await uploadLinkPreviewThumb(agent, preview.imageUrl)
      embed = {
        $type: 'app.bsky.embed.external',
        external: {
          uri: preview.url,
          title: preview.title,
          description: preview.description ?? '',
          ...(thumb ? { thumb } : {})
        }
      }
    }
  }

  const labels =
    status.sensitive && images.length > 0
      ? {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'graphic-media' }]
        }
      : undefined

  const language = status.language?.trim()

  return {
    $type: POST_COLLECTION,
    text: finalText,
    ...(facets.length > 0 ? { facets } : {}),
    ...(replyRefs ? { reply: replyRefs } : {}),
    ...(embed ? { embed } : {}),
    ...(labels ? { labels } : {}),
    createdAt: new Date(status.createdAt).toISOString(),
    ...(language ? { langs: [language] } : {})
  }
}

const isRetryableCrosspostError = (error: unknown): boolean => {
  if (error instanceof BlueskyLockTimeoutError) return true
  if (error instanceof BlueskySessionChangedError) return true
  if (error instanceof BlueskyRequestError) {
    return error.status >= 500 || error.status === 429
  }
  if (error instanceof BlueskySessionEndedError) return false
  if (error instanceof BlueskyActionError) return false
  if (error instanceof BlueskyImageTooLargeError) return false
  if (error instanceof BlueskyUnexpectedAnswerError) return false
  // A refused URL or an oversized body is final; anything else (a transport
  // failure, an abort) may pass, so the queue retries it.
  if (error instanceof Error && error.name === 'SafeRemoteFetchError') {
    return false
  }
  return true
}

const failureMessage = (error: unknown): string => {
  if (error instanceof BlueskySessionEndedError) {
    return BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE
  }
  if (error instanceof BlueskyImageTooLargeError) {
    return BLUESKY_CROSSPOST_IMAGE_TOO_LARGE_MESSAGE
  }
  if (error instanceof BlueskyActionError) return error.message
  return BLUESKY_CROSSPOST_FAILED_MESSAGE
}

/**
 * Posts a claimed local status to the author's linked Bluesky account. A no-op
 * unless the status is a public local Note/Poll with a pending cross-post row
 * and a linked account. A reply is cross-posted only under its author's own
 * cross-posted post. Failures that cannot succeed on a retry mark the row
 * failed; transient ones are rethrown so the queue retries.
 */
export const crosspostStatus = async (
  database: Database,
  statusId: string
): Promise<void> => {
  const row = await database.getBlueskyCrosspost({ statusId })
  if (!row || row.state !== 'pending') return
  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status || !isCrosspostableStatus(status)) {
    // Made non-public (or gone) before the job ran: nothing to post.
    await database.deleteBlueskyCrosspost({ statusId })
    return
  }

  const account = await database.getBlueskyAccount({ actorId: status.actorId })
  if (!account) {
    await database.markBlueskyCrosspostFailed({
      statusId,
      error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
    })
    return
  }
  if (!(await isBlueskyAllowed(database))) {
    await database.markBlueskyCrosspostFailed({
      statusId,
      error: BLUESKY_NOT_ALLOWED_MESSAGE
    })
    return
  }
  const actor = await database.getActorFromId({ id: status.actorId })
  if (!actor) {
    await database.markBlueskyCrosspostFailed({
      statusId,
      error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
    })
    return
  }

  try {
    await createBlueskyLock(database)(
      `${BLUESKY_CROSSPOST_LOCK_PREFIX}${status.actorId}`,
      async () => {
        // Re-check inside the lock: another run may have posted it already.
        const current = await database.getBlueskyCrosspost({ statusId })
        if (!current || current.state !== 'pending') return

        const agent = await getBlueskyAgent(database, actor)
        if (!agent) {
          await database.markBlueskyCrosspostFailed({
            statusId,
            error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
          })
          return
        }

        let replyRefs: { root: StrongRef; parent: StrongRef } | null = null
        if (status.reply) {
          const resolved = await resolveReplyRefs(database, status)
          if (resolved === 'retry') {
            throw new Error('The parent cross-post is not posted yet')
          }
          if (!resolved) {
            await database.deleteBlueskyCrosspost({ statusId })
            return
          }
          replyRefs = resolved
        }

        const record = await buildRecord(database, agent, status, replyRefs)
        const answer = await agent.post<{ uri?: unknown; cid?: unknown }>(
          'com.atproto.repo.createRecord',
          {
            repo: agent.did,
            collection: POST_COLLECTION,
            record
          }
        )

        const uri = typeof answer?.uri === 'string' ? answer.uri : ''
        const cid = typeof answer?.cid === 'string' ? answer.cid : ''
        const parsed = parseAtUri(uri)
        if (
          !CID_V1_BASE32_PATTERN.test(cid) ||
          parsed?.did !== agent.did ||
          parsed.collection !== POST_COLLECTION
        ) {
          throw new BlueskyUnexpectedAnswerError(
            'com.atproto.repo.createRecord'
          )
        }

        // Record the uri before anything else can throw: a retry must never
        // post the same status twice.
        await database.markBlueskyCrosspostPosted({ statusId, uri, cid })
      }
    )
  } catch (error) {
    // An inline queue (NoQueue) never retries, so a transient failure there is
    // marked failed too: the owner's Retry is then the way to post it.
    if (isRetryableCrosspostError(error) && !getQueue().runsInline) throw error
    logger.warn({
      message: 'Bluesky cross-post failed',
      statusId,
      err: toLoggableError(error)
    })
    await database.markBlueskyCrosspostFailed({
      statusId,
      error: failureMessage(error)
    })
  }
}

/**
 * Claims a status for cross-posting and queues the job, when the author is
 * linked, the post is public, and (for a reply) its parent is the author's own
 * cross-posted post. Never throws: a cross-post must not fail the local post.
 */
export const enqueueBlueskyCrosspost = async (
  database: Database,
  { actor, status, wanted }: { actor: Actor; status: Status; wanted?: boolean }
): Promise<void> => {
  if (!isCrosspostableStatus(status) || status.actorId !== actor.id) return
  const account = await database.getBlueskyAccount({ actorId: actor.id })
  if (!account) return
  if (!(wanted ?? account.crosspostByDefault)) return
  if (!(await isBlueskyAllowed(database))) return
  if (status.reply) {
    const parent = await database.getStatus({
      statusId: status.reply,
      withReplies: false
    })
    if (!parent || parent.actorId !== actor.id) return
    const parentCrosspost = await database.getBlueskyCrosspost({
      statusId: parent.id
    })
    if (
      !parentCrosspost ||
      (parentCrosspost.state !== 'posted' &&
        parentCrosspost.state !== 'pending')
    ) {
      return
    }
  }
  const claimed = await database.claimBlueskyCrosspost({
    statusId: status.id,
    actorId: actor.id
  })
  if (!claimed) return
  await getQueue().publish({
    id: getHashFromString(`${status.id}#bluesky-crosspost`),
    name: CROSSPOST_BLUESKY_JOB_NAME,
    data: { statusId: status.id }
  })
}

/**
 * `enqueueBlueskyCrosspost` for a status id whose actor is not already loaded
 * (the fitness import jobs). Never throws.
 */
export const enqueueBlueskyCrosspostForStatus = async (
  database: Database,
  {
    actorId,
    statusId,
    wanted
  }: { actorId: string; statusId: string; wanted?: boolean }
): Promise<void> => {
  try {
    const actor = await database.getActorFromId({ id: actorId })
    if (!actor) return
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status) return
    await enqueueBlueskyCrosspost(database, { actor, status, wanted })
  } catch (error) {
    logger.error({
      message: 'Could not queue a Bluesky cross-post',
      actorId,
      statusId,
      err: toLoggableError(error)
    })
  }
}
