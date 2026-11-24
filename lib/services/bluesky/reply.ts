// Replying to a Bluesky post and deleting the viewer's own Bluesky post.
// Writes go to the user's linked PDS; stored content (parent lookup, mention
// DIDs, and reply readback) always comes from the public AppView, never from
// the PDS. Never creates an ActivityPub note or enqueues an ActivityPub
// delivery.
import crypto from 'node:crypto'

import {
  IdempotencyConflictError,
  IdempotencyDeletedError
} from '@/lib/database/domains/idempotency/types'
import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { isBlueskyStatus } from '@/lib/types/domain/status'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import {
  BLUESKY_MAX_GRAPHEMES,
  BLUESKY_MAX_UTF8_BYTES,
  BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE,
  BLUESKY_TOO_LONG_MESSAGE,
  countBlueskyGraphemes,
  countBlueskyUtf8Bytes
} from '@/lib/utils/blueskyText'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { BlueskyActionError } from './actionErrors'
import {
  BlueskyRequestError,
  BlueskySessionChangedError,
  getBlueskyAgent
} from './agent'
import { getPublicPosts } from './appview'
import { createBlueskyLock } from './client'
import { BLUESKY_NOT_ALLOWED_MESSAGE, isBlueskyAllowed } from './policy'
import {
  type BlueskyPostView,
  blueskyActorId,
  blueskyPostId,
  optionalString,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyPostView
} from './records'
import { buildBlueskyFacets, normalizeBlueskyMentions } from './richText'

export { BLUESKY_REPLY_POSTED_NOT_STORED_MESSAGE }

const POST_COLLECTION = 'app.bsky.feed.post'
const CID_V1_BASE32_PATTERN = /^b[a-z2-7]{50,}$/

export const BLUESKY_REPLY_LOCK_PREFIX = 'bluesky-reply:'
export const BLUESKY_REPLY_BUSY_MESSAGE =
  'Another reply is being posted. Try again in a moment.'
export const BLUESKY_DELETE_BUSY_MESSAGE =
  'Another Bluesky change is in progress. Try again in a moment.'
export const BLUESKY_EDIT_REFUSED_MESSAGE = 'Edits are not sent to Bluesky.'
export const BLUESKY_REPLY_RATE_LIMIT_MESSAGE =
  'Too many Bluesky replies. Try again in a few minutes.'
export const BLUESKY_REPLY_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60 * 1000
}

export class BlueskyReplyRateLimitError extends Error {
  readonly status = 429 as const

  constructor(message = BLUESKY_REPLY_RATE_LIMIT_MESSAGE) {
    super(message)
    this.name = 'BlueskyReplyRateLimitError'
  }
}

export type ReplyToBlueskyPostResult =
  { stored: true; statusId: string } | { stored: false }

const NOT_LINKED_REPLY =
  'Link a Bluesky account in Settings › Other networks to reply to Bluesky posts.'
const NOT_LINKED_DELETE =
  'Link a Bluesky account in Settings › Other networks to delete Bluesky posts.'
const VISIBILITY_REFUSED =
  'Replies to Bluesky posts are public: Bluesky has no followers-only or direct posts.'
const MEDIA_REFUSED = 'Images in Bluesky replies are not supported yet.'
const POLL_REFUSED = 'Polls in Bluesky replies are not supported.'
const SPOILER_REFUSED = 'Content warnings are not supported on Bluesky replies.'
const EMPTY_TEXT_REFUSED = 'Reply text cannot be empty.'
const PARENT_NOT_ON_APPVIEW =
  'Bluesky could not find the post you are replying to.'

const READBACK_RETRIES = 3
const READBACK_RETRY_DELAY_MS = 500

export interface ReplyToBlueskyPostInput {
  parentStatusId: string
  text: string
  visibility?: string
  mediaIds?: string[]
  poll?: unknown
  spoilerText?: string | null
  sensitive?: boolean
  language?: string | null
  idempotency?: {
    key: string
    contentHash: string
  }
}

export interface ReplyToBlueskyPostOptions {
  /** Override wait between AppView readback retries (for tests). */
  wait?: (ms: number) => Promise<void>
}

type StrongRef = { uri: string; cid: string }

const defaultWait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const withReplyLock = <T>(
  database: Database,
  actor: Actor,
  fn: () => Promise<T>
) => createBlueskyLock(database)(`${BLUESKY_REPLY_LOCK_PREFIX}${actor.id}`, fn)

const requireAgent = async (
  database: Database,
  actor: Actor,
  notLinkedMessage: string
) => {
  const agent = await getBlueskyAgent(database, actor)
  if (!agent) throw new BlueskyActionError(notLinkedMessage)
  return agent
}

const validateReplyInput = (
  input: ReplyToBlueskyPostInput,
  normalizedText: string
) => {
  if (
    input.visibility !== undefined &&
    input.visibility !== 'public' &&
    input.visibility !== 'unlisted'
  ) {
    throw new BlueskyActionError(VISIBILITY_REFUSED)
  }
  if (input.mediaIds && input.mediaIds.length > 0) {
    throw new BlueskyActionError(MEDIA_REFUSED)
  }
  if (input.poll) {
    throw new BlueskyActionError(POLL_REFUSED)
  }
  if (input.spoilerText && input.spoilerText.trim().length > 0) {
    throw new BlueskyActionError(SPOILER_REFUSED)
  }
  if (!normalizedText || normalizedText.trim().length === 0) {
    throw new BlueskyActionError(EMPTY_TEXT_REFUSED)
  }
  if (
    countBlueskyGraphemes(normalizedText) > BLUESKY_MAX_GRAPHEMES ||
    countBlueskyUtf8Bytes(normalizedText) > BLUESKY_MAX_UTF8_BYTES
  ) {
    throw new BlueskyActionError(BLUESKY_TOO_LONG_MESSAGE)
  }
}

const extractReplyRoot = (
  record: Record<string, unknown>
): StrongRef | null => {
  if (!isRecord(record.reply) || !isRecord(record.reply.root)) return null
  const uri = optionalString(record.reply.root.uri)
  const cid = optionalString(record.reply.root.cid)
  if (!uri || !cid) return null
  const parsed = parseAtUri(uri)
  if (!parsed || parsed.collection !== POST_COLLECTION) return null
  return { uri, cid }
}

const readPublicPostByUri = async (
  uri: string
): Promise<BlueskyPostView | null> => {
  const views = await getPublicPosts([uri])
  for (const value of views) {
    const parsed = parseBlueskyPostView(value)
    if (parsed && parsed.uri === uri) return parsed
  }
  return null
}

// Reads the newly written post back from the public AppView (retrying briefly
// for indexing lag). Never constructs a stored view from PDS or local input.
const readBackReplyFromAppView = async (
  uri: string,
  authorDid: string,
  wait: (ms: number) => Promise<void>
): Promise<BlueskyPostView | null> => {
  for (let attempt = 0; attempt <= READBACK_RETRIES; attempt += 1) {
    if (attempt > 0) await wait(READBACK_RETRY_DELAY_MS)
    try {
      const found = await readPublicPostByUri(uri)
      if (found && found.at.did === authorDid) return found
    } catch (error) {
      logger.warn({
        message: 'Failed to read back Bluesky reply from AppView',
        uri,
        attempt,
        err: toLoggableError(error)
      })
    }
  }
  return null
}

const writeReply = async (
  database: Database,
  actor: Actor,
  input: ReplyToBlueskyPostInput,
  wait: (ms: number) => Promise<void>
): Promise<ReplyToBlueskyPostResult> => {
  // Re-check Idempotency-Key inside the per-actor reply lock so a concurrent
  // retry that arrived while the first request was posting sees the recorded
  // key instead of creating a second reply on Bluesky.
  if (input.idempotency) {
    const existingKey = await database.getIdempotencyKey({
      actorId: actor.id,
      key: input.idempotency.key
    })
    if (existingKey) {
      if (
        existingKey.contentHash !== null &&
        existingKey.contentHash !== input.idempotency.contentHash
      ) {
        throw new IdempotencyConflictError()
      }
      const existingStatus = await database.getStatus({
        statusId: existingKey.statusId,
        currentActorId: actor.id,
        withReplies: false
      })
      if (existingStatus) {
        return { stored: true, statusId: existingStatus.id }
      }
      if (isBlueskyId(existingKey.statusId)) {
        return { stored: false }
      }
      throw new IdempotencyDeletedError(existingKey.statusId)
    }
  }

  if (!(await isBlueskyAllowed(database))) {
    throw new BlueskyActionError(BLUESKY_NOT_ALLOWED_MESSAGE)
  }
  const text = normalizeBlueskyMentions(input.text)
  validateReplyInput(input, text)

  const parentStatus = await database.getStatus({
    statusId: input.parentStatusId,
    withReplies: false
  })
  const parentRecord =
    parentStatus && isBlueskyStatus(parentStatus)
      ? await database.getBlueskyRecordByStatusId({ statusId: parentStatus.id })
      : null
  if (!parentRecord) {
    throw new BlueskyActionError('Record not found', 404)
  }

  const actorDigest = crypto.createHash('sha256').update(actor.id).digest('hex')
  const budget = await database.consumeRateLimit({
    key: `${APP_RATE_LIMIT_KEY_PREFIX}bluesky-reply:${actorDigest}`,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    ...BLUESKY_REPLY_RATE_LIMIT
  })
  if (!budget.allowed) {
    throw new BlueskyReplyRateLimitError()
  }

  const agent = await requireAgent(database, actor, NOT_LINKED_REPLY)

  const parentView = await readPublicPostByUri(parentRecord.uri)
  if (!parentView) {
    throw new BlueskyActionError(PARENT_NOT_ON_APPVIEW)
  }
  const parent: StrongRef = { uri: parentRecord.uri, cid: parentView.cid }
  const root: StrongRef = extractReplyRoot(parentView.record) ?? parent

  const facets = await buildBlueskyFacets(text)
  const createdAt = new Date().toISOString()
  const language = input.language?.trim()
  const record: Record<string, unknown> = {
    $type: POST_COLLECTION,
    text,
    ...(facets.length > 0 ? { facets } : {}),
    reply: { root, parent },
    createdAt,
    ...(language ? { langs: [language] } : {})
  }

  const answer = await agent.post<{ uri?: unknown; cid?: unknown }>(
    'com.atproto.repo.createRecord',
    {
      repo: agent.did,
      collection: POST_COLLECTION,
      record
    }
  )

  // Once createRecord has succeeded, the reply may exist on Bluesky. Nothing
  // after this point may throw a retryable error (a retry would post a
  // duplicate reply); any readback, validation, relink, or storage issue
  // signals `{ stored: false }` so the caller tells the user it is on Bluesky.
  try {
    const uri = typeof answer?.uri === 'string' ? answer.uri : ''
    const cid = typeof answer?.cid === 'string' ? answer.cid : ''
    const parsed = parseAtUri(uri)
    if (
      !CID_V1_BASE32_PATTERN.test(cid) ||
      parsed?.did !== agent.did ||
      parsed.collection !== POST_COLLECTION
    ) {
      logger.warn({
        message:
          'Bluesky createRecord returned an unexpected uri or cid; skipping local storage',
        actorId: actor.id,
        uri,
        cid
      })
      return { stored: false }
    }

    const deterministicStatusId = blueskyPostId(parsed.did, parsed.rkey)
    if (input.idempotency) {
      try {
        await database.createCompletedIdempotencyKey({
          actorId: actor.id,
          key: input.idempotency.key,
          statusId: deterministicStatusId,
          contentHash: input.idempotency.contentHash
        })
      } catch (error) {
        logger.error({
          message: 'Failed to record Idempotency-Key for Bluesky reply',
          actorId: actor.id,
          statusId: deterministicStatusId,
          err: toLoggableError(error)
        })
      }
    }

    const postView = await readBackReplyFromAppView(uri, agent.did, wait)
    if (!postView) {
      return { stored: false }
    }

    // Re-check the linked DID before storing so a relink during the PDS/AppView
    // calls cannot attribute the reply to a replaced session.
    const link = await database.getBlueskyAccount({ actorId: actor.id })
    if (!link || link.did !== agent.did) {
      logger.warn({
        message:
          'Bluesky link changed after createRecord; skipping local storage',
        actorId: actor.id,
        uri
      })
      return { stored: false }
    }

    const statusId = await storeBlueskyPostView(database, postView)
    if (!statusId) {
      logger.warn({
        message: 'Could not store Bluesky reply locally after createRecord',
        actorId: actor.id,
        uri
      })
      return { stored: false }
    }
    return { stored: true, statusId }
  } catch (error) {
    logger.warn({
      message: 'Failed to store Bluesky reply locally after createRecord',
      actorId: actor.id,
      err: toLoggableError(error)
    })
    return { stored: false }
  }
}

/**
 * Publishes a reply to a stored Bluesky post on the actor's linked PDS and
 * stores the resulting AppView post locally when available. Returns
 * `{ stored: true, statusId }` when stored, or `{ stored: false }` when the
 * reply reached Bluesky but could not be read back or stored locally yet.
 */
export const replyToBlueskyPost = async (
  database: Database,
  actor: Actor,
  input: ReplyToBlueskyPostInput,
  options?: ReplyToBlueskyPostOptions
): Promise<ReplyToBlueskyPostResult> =>
  withReplyLock(database, actor, () =>
    writeReply(database, actor, input, options?.wait ?? defaultWait)
  )

const removeOwnPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<void> => {
  if (!(await isBlueskyAllowed(database))) {
    throw new BlueskyActionError(BLUESKY_NOT_ALLOWED_MESSAGE)
  }
  const status = await database.getStatus({ statusId, withReplies: false })
  if (!status || !isBlueskyStatus(status)) {
    throw new BlueskyActionError('Record not found', 404)
  }

  const agent = await requireAgent(database, actor, NOT_LINKED_DELETE)
  const ownActorId = blueskyActorId(agent.did)
  if (status.actorId !== ownActorId) {
    throw new BlueskyActionError('You can only delete your own Bluesky posts.')
  }

  const record = await database.getBlueskyRecordByStatusId({ statusId })
  const parsed = record ? parseAtUri(record.uri) : null
  if (
    !parsed ||
    parsed.did !== agent.did ||
    parsed.collection !== POST_COLLECTION
  ) {
    throw new BlueskyActionError('Record not found', 404)
  }

  try {
    await agent.post('com.atproto.repo.deleteRecord', {
      repo: parsed.did,
      collection: parsed.collection,
      rkey: parsed.rkey
    })
  } catch (error) {
    // Already deleted on Bluesky (from another app): only the local row is left.
    if (
      !(error instanceof BlueskyRequestError) ||
      error.error !== 'RecordNotFound'
    ) {
      throw error
    }
  }

  const link = await database.getBlueskyAccount({ actorId: actor.id })
  if (!link) throw new BlueskyActionError(NOT_LINKED_DELETE)
  if (link.did !== agent.did) throw new BlueskySessionChangedError()

  await database.deleteStatus({ statusId, actorId: ownActorId })
}

/**
 * Deletes the actor's own Bluesky post on their PDS (tolerating RecordNotFound)
 * and removes the local status row without queueing any ActivityPub Delete.
 */
export const deleteOwnBlueskyPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<void> =>
  withReplyLock(database, actor, () => removeOwnPost(database, actor, statusId))
