// Cross-posting a local public post to the author's linked Bluesky account.
// The record is written to the user's PDS; the text, facets, images and link
// card are built from the local status only. A cross-post is claimed once
// (bluesky_crossposts) and its uri is recorded before anything after
// createRecord can throw, so a retry never posts it twice.
import { STALE_CROSSPOST_MS } from '@/lib/database/domains/bluesky/queries'
import type { BlueskyCrosspost } from '@/lib/database/domains/bluesky/types'
import type { Database } from '@/lib/database/types'
import { CROSSPOST_BLUESKY_JOB_NAME } from '@/lib/jobs/names'
import {
  isActorConfirmationPending,
  isActorModerationBlocked
} from '@/lib/services/guards/accountState'
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
  BlueskySessionEndedError,
  BlueskyUnexpectedAnswerError,
  getBlueskyAgent
} from './agent'
import { getPublicPosts } from './appview'
import { BlueskyLockTimeoutError, createBlueskyLock } from './client'
import {
  BlueskyImageFormatError,
  BlueskyImageTooLargeError,
  buildCrosspostText,
  fitImageForBluesky,
  markdownToBlueskyPlainText
} from './crosspostText'
import { BLUESKY_NOT_ALLOWED_MESSAGE, isBlueskyAllowed } from './policy'
import { optionalString, parseAtUri, parseBlueskyPostView } from './records'
import { buildBlueskyFacets, normalizeBlueskyMentions } from './richText'

const POST_COLLECTION = 'app.bsky.feed.post'
// A CIDv1 in base32, bounded so a hostile PDS cannot hand back a megabyte.
const CID_V1_BASE32_PATTERN = /^b[a-z2-7]{50,100}$/
const MAX_URI_LENGTH = 512
const MAX_CID_LENGTH = 255
const MAX_IMAGES = 4
const LINK_PREVIEW_IMAGE_MAX_BYTES = 10 * 1024 * 1024

export const BLUESKY_CROSSPOST_LOCK_PREFIX = 'bluesky-crosspost:'
export const BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE =
  'Link a Bluesky account in Settings › Other networks to cross-post.'
export const BLUESKY_CROSSPOST_FAILED_MESSAGE =
  'Bluesky did not accept the post.'
export const BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE =
  'Bluesky gave an unexpected answer.'
export const BLUESKY_CROSSPOST_IMAGE_TOO_LARGE_MESSAGE =
  'An image is too large for Bluesky.'
export const BLUESKY_CROSSPOST_IMAGE_FORMAT_MESSAGE =
  'An image is not a format Bluesky accepts.'
export const BLUESKY_CROSSPOST_QUEUE_FAILED_MESSAGE =
  'Could not queue the Bluesky post.'
export const BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE =
  'Bluesky ended this session.'

type StrongRef = { uri: string; cid: string }

type PostStatus = StatusNote | StatusPoll

// A row can be attempted while it is 'pending', or when a prior 'posting'
// attempt went stale (older than STALE_CROSSPOST_MS, e.g. worker crashed).
const isCrosspostAttemptable = (row: BlueskyCrosspost): boolean =>
  row.state === 'pending' ||
  (row.state === 'posting' && row.updatedAt < Date.now() - STALE_CROSSPOST_MS)

// A boost is never cross-posted: only the author's own public Note or Poll.
const isCrosspostableStatus = (status: Status): status is PostStatus =>
  status.type !== StatusType.enum.Announce &&
  status.isLocalActor &&
  !isBlueskyStatus(status) &&
  getStatusVisibility(status) === 'public'

// The actor may no longer act: suspended, disabled, unconfirmed or deleting.
const isActorUsable = (actor: Actor): boolean =>
  !isActorModerationBlocked(actor) &&
  !isActorConfirmationPending(actor) &&
  !actor.deletionStatus

const isCrosspostImage = (attachment: PostStatus['attachments'][number]) => {
  if (isFitnessAttachment(attachment)) return false
  // A fitness route map is a GPS trace, never a photo for Bluesky.
  if (attachment.isRouteMap) return false
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
  if (
    parentCrosspost.state === 'pending' ||
    parentCrosspost.state === 'posting'
  ) {
    return 'retry'
  }
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
  actor: Actor,
  attachment: PostStatus['attachments'][number]
) => {
  // The attachment URL is client-supplied, so it is never read: only the media
  // row the status's own actor owns, and only that row's own stored file.
  const mediaId = attachment.mediaId
  const accountId = actor.account?.id
  if (!mediaId || !accountId) return null
  const media = await database.getMediaByIdForAccount({ mediaId, accountId })
  if (!media || media.actorId !== actor.id) return null
  // A presigned upload's bytes are the client's until completion verified them.
  if (media.original.metaData.upload?.state === 'pending') return null
  const stored = await readStoredImage(database, media.original.path)
  if (!stored) return null
  const fitted = await fitImageForBluesky(stored.buffer)
  const blob = await agent.uploadBlob(fitted.bytes, fitted.mimeType)
  return {
    image: blob,
    alt: attachment.name ?? '',
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
    // The bytes are sniffed, so a wrong Content-Type cannot mislabel them.
    const fitted = await fitImageForBluesky(Buffer.from(bytes))
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
  actor: Actor,
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
      const uploaded = await uploadImage(database, agent, actor, attachment)
      if (!uploaded) {
        hasDroppedMedia = true
        continue
      }
      images.push(uploaded)
    }
  }

  // Quoting a Bluesky post is refused when the quote is created, so a quote
  // here is always of a fediverse post: only its URL is appended to the text.
  let fediverseQuoteUrl: string | null = null
  if (status.quote) {
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

  // A content warning is all the copy says; the text and media stay here, and
  // a content-warning post never carries an embed. A poll links to where it can
  // be voted on.
  let embed: Record<string, unknown> | undefined
  if (images.length > 0) {
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

// A reply whose parent cross-post is still pending: the queue must run it again
// once the parent has posted.
class BlueskyCrosspostRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlueskyCrosspostRetryError'
  }
}

// Only a transient failure is worth another attempt: a 5xx/429 from the PDS, a
// transport failure or timeout, the lock timeout, or a reply waiting on its
// parent. Everything else (a refused request, a decode or format error, an
// unexpected answer, an ended session) is permanent, so the row is marked
// failed and the owner's Retry is the way to try again.
const isRetryableCrosspostError = (error: unknown): boolean => {
  if (error instanceof BlueskyLockTimeoutError) return true
  if (error instanceof BlueskyCrosspostRetryError) return true
  if (error instanceof BlueskyRequestError) {
    return error.status >= 500 || error.status === 429
  }
  if (error instanceof Error) {
    // safeRemoteFetch's transport failure (a reset, a timeout) may pass; its
    // own refusal (an unsafe address, a redirect, an oversized body) is final.
    if (error.name === 'RemoteTransportError') return true
    if (error.name === 'AbortError' || error.name === 'TimeoutError')
      return true
  }
  return false
}

const failureMessage = (error: unknown): string => {
  if (error instanceof BlueskySessionEndedError) {
    return BLUESKY_CROSSPOST_SESSION_ENDED_MESSAGE
  }
  if (error instanceof BlueskyImageTooLargeError) {
    return BLUESKY_CROSSPOST_IMAGE_TOO_LARGE_MESSAGE
  }
  if (error instanceof BlueskyImageFormatError) {
    return BLUESKY_CROSSPOST_IMAGE_FORMAT_MESSAGE
  }
  if (error instanceof BlueskyUnexpectedAnswerError) {
    return BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
  }
  if (error instanceof BlueskyActionError) return error.message
  return BLUESKY_CROSSPOST_FAILED_MESSAGE
}

// Best effort: removes a record this server created but could not keep (the
// post was deleted while the record was being written).
const deleteCrosspostRecord = async (agent: BlueskyAgent, uri: string) => {
  const parsed = parseAtUri(uri)
  if (parsed?.did !== agent.did || parsed.collection !== POST_COLLECTION) return
  try {
    await agent.post('com.atproto.repo.deleteRecord', {
      repo: parsed.did,
      collection: parsed.collection,
      rkey: parsed.rkey
    })
  } catch (error) {
    if (
      error instanceof BlueskyRequestError &&
      error.error === 'RecordNotFound'
    ) {
      return
    }
    logger.warn({
      message: 'Could not delete a Bluesky cross-post copy',
      uri,
      err: toLoggableError(error)
    })
  }
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
  if (!row || !isCrosspostAttemptable(row)) return
  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status || !isCrosspostableStatus(status)) {
    // Made non-public (or gone) before the job ran: drop only if still pending.
    await database.deleteBlueskyCrosspostIfPending({ statusId })
    return
  }

  const account = await database.getBlueskyAccount({ actorId: status.actorId })
  if (!account) {
    await database.markBlueskyCrosspostFailedIfPending({
      statusId,
      error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
    })
    return
  }
  if (!(await isBlueskyAllowed(database))) {
    await database.markBlueskyCrosspostFailedIfPending({
      statusId,
      error: BLUESKY_NOT_ALLOWED_MESSAGE
    })
    return
  }
  const actor = await database.getActorFromId({ id: status.actorId })
  if (!actor) {
    await database.markBlueskyCrosspostFailedIfPending({
      statusId,
      error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
    })
    return
  }

  let attemptId: string | null = null
  try {
    await createBlueskyLock(database)(
      `${BLUESKY_CROSSPOST_LOCK_PREFIX}${status.actorId}`,
      async () => {
        // Re-check inside the lock: another run may have posted it already or
        // may still be posting it, and the post or the actor may have changed
        // since the job was queued.
        const current = await database.getBlueskyCrosspost({ statusId })
        if (!current || !isCrosspostAttemptable(current)) return

        const currentStatus = await database.getStatus({
          statusId,
          withReplies: false
        })
        const currentActor = await database.getActorFromId({
          id: status.actorId
        })
        if (
          !currentStatus ||
          !isCrosspostableStatus(currentStatus) ||
          !currentActor ||
          !isActorUsable(currentActor)
        ) {
          // No longer crosspostable: drop only if still pending and post nothing.
          await database.deleteBlueskyCrosspostIfPending({ statusId })
          return
        }

        const agent = await getBlueskyAgent(database, currentActor)
        if (!agent) {
          await database.markBlueskyCrosspostFailedIfPending({
            statusId,
            error: BLUESKY_CROSSPOST_NOT_LINKED_MESSAGE
          })
          return
        }

        let replyRefs: { root: StrongRef; parent: StrongRef } | null = null
        if (currentStatus.reply) {
          const resolved = await resolveReplyRefs(database, currentStatus)
          if (resolved === 'retry') {
            throw new BlueskyCrosspostRetryError(
              'The parent cross-post is not posted yet'
            )
          }
          if (!resolved) {
            await database.deleteBlueskyCrosspostIfPending({ statusId })
            return
          }
          replyRefs = resolved
        }

        // Atomically claim the exclusive posting attempt right before uploading
        // media and creating the record: if the per-actor lock later expires
        // during slow uploads, a second job sees 'posting' and stops instead of
        // calling createRecord twice.
        const claimedAttemptId = await database.beginBlueskyCrosspostAttempt({
          statusId
        })
        if (!claimedAttemptId) {
          return
        }
        attemptId = claimedAttemptId

        const record = await buildRecord(
          database,
          agent,
          currentActor,
          currentStatus,
          replyRefs
        )
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
          uri.length > MAX_URI_LENGTH ||
          cid.length > MAX_CID_LENGTH ||
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
        let posted: boolean
        try {
          posted = await database.markBlueskyCrosspostPosted({
            statusId,
            attemptId: claimedAttemptId,
            uri,
            cid
          })
        } catch (error) {
          // The record exists now, so a retry must never create it again.
          logger.warn({
            message: 'Could not record a Bluesky cross-post',
            statusId,
            err: toLoggableError(error)
          })
          await database
            .markBlueskyCrosspostFailed({
              statusId,
              attemptId: claimedAttemptId,
              error: BLUESKY_CROSSPOST_UNEXPECTED_MESSAGE
            })
            .catch(() => undefined)
          throw new BlueskyUnexpectedAnswerError(
            'com.atproto.repo.createRecord'
          )
        }

        if (!posted) {
          // The post was deleted (or narrowed from public), or another attempt
          // took over after this one went stale, while its record was being
          // created: remove the copy so Bluesky does not keep an orphaned post.
          await deleteCrosspostRecord(agent, uri)
        }
      }
    )
  } catch (error) {
    // An inline queue (NoQueue) never retries, so a transient failure there is
    // marked failed too: the owner's Retry is then the way to post it.
    // shortcut: the job runner does not expose the attempt number or the last
    // attempt, so a real queue's final attempt is not detected here. A
    // retryable error releases a 'posting' attempt back to 'pending' with a
    // fresh updatedAt (so active queue retries past 30 min do not look stale)
    // and rethrows for the queue to retry; when the queue dead-letters the job
    // the row stays pending, and once updatedAt is older than
    // STALE_CROSSPOST_MS hydration reports it as failed and the owner's Retry
    // resets it (resetBlueskyCrosspostForRetry).
    if (isRetryableCrosspostError(error) && !getQueue().runsInline) {
      if (attemptId) {
        await database.releaseBlueskyCrosspostAttempt({ statusId, attemptId })
      }
      throw error
    }
    logger.warn({
      message: 'Bluesky cross-post failed',
      statusId,
      err: toLoggableError(error)
    })
    if (attemptId) {
      await database.markBlueskyCrosspostFailed({
        statusId,
        attemptId,
        error: failureMessage(error)
      })
    } else {
      await database.markBlueskyCrosspostFailedIfPending({
        statusId,
        error: failureMessage(error)
      })
    }
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
  if (!isActorUsable(actor)) return
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
        parentCrosspost.state !== 'pending' &&
        parentCrosspost.state !== 'posting')
    ) {
      return
    }
  }
  const claimed = await database.claimBlueskyCrosspost({
    statusId: status.id,
    actorId: actor.id
  })
  if (!claimed) return
  try {
    await getQueue().publish({
      id: getHashFromString(`${status.id}#bluesky-crosspost`),
      name: CROSSPOST_BLUESKY_JOB_NAME,
      data: { statusId: status.id }
    })
  } catch (error) {
    // The row was claimed but the job never queued: mark it failed so the
    // owner's Retry is offered instead of a row stuck pending forever.
    logger.warn({
      message: 'Could not queue a Bluesky cross-post',
      statusId: status.id,
      err: toLoggableError(error)
    })
    await database
      .markBlueskyCrosspostFailedIfPending({
        statusId: status.id,
        error: BLUESKY_CROSSPOST_QUEUE_FAILED_MESSAGE
      })
      .catch(() => undefined)
  }
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
