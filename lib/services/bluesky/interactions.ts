// Liking and reposting a Bluesky post adopts or writes an app.bsky.feed.like
// or app.bsky.feed.repost record in the user's own PDS; bluesky_interactions
// keeps its at:// URI for unliking / unreposting, while local likes and
// local-only Announce rows drive favourited/reblogged state and timelines
// without ActivityPub federation or notifications.
import { createLocalAnnounce } from '@/lib/actions/announce'
import type {
  BlueskyInteraction,
  BlueskyInteractionKind,
  BlueskyRecord
} from '@/lib/database/domains/bluesky/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { type Status, StatusType } from '@/lib/types/domain/status'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  BlueskyActionError,
  type BlueskyActionFailure,
  blueskyActionFailure
} from './actionErrors'
import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionChangedError,
  getBlueskyAgent
} from './agent'
import { createBlueskyLock } from './client'
import { BLUESKY_NOT_ALLOWED_MESSAGE, isBlueskyAllowed } from './policy'
import { parseAtUri } from './records'

const COLLECTIONS: Record<BlueskyInteractionKind, string> = {
  like: 'app.bsky.feed.like',
  repost: 'app.bsky.feed.repost'
}

const NOT_LINKED =
  'Link a Bluesky account in Settings › Other networks to interact with Bluesky posts.'

export const BLUESKY_INTERACTION_LOCK_PREFIX = 'bluesky-interaction:'

const BUSY_MESSAGE =
  'Another change to this post is in progress. Try again in a moment.'

// bluesky_interactions.uri is varchar(512).
const MAX_INTERACTION_URI_LENGTH = 512

const requireAgent = async (database: Database, actor: Actor) => {
  const agent = await getBlueskyAgent(database, actor)
  if (!agent) throw new BlueskyActionError(NOT_LINKED)
  return agent
}

const withInteractionLock = <T>(
  database: Database,
  actor: Actor,
  statusId: string,
  kind: BlueskyInteractionKind,
  fn: () => Promise<T>
) =>
  createBlueskyLock(database)(
    `${BLUESKY_INTERACTION_LOCK_PREFIX}${actor.id}:${statusId}:${kind}`,
    fn
  )

const requireBlueskyPostRecord = async (
  database: Database,
  statusId: string
): Promise<BlueskyRecord> => {
  const [status, record] = await Promise.all([
    database.getStatus({ statusId, withReplies: false }),
    database.getBlueskyRecordByStatusId({ statusId })
  ])
  if (
    !status ||
    status.type === StatusType.enum.Announce ||
    status.network !== 'bluesky' ||
    !record
  ) {
    throw new BlueskyActionError('Record not found', 404)
  }
  return record
}

/**
 * The user's existing like/repost record for `postUri` (say, made in another
 * app), or null. Best effort: viewer state from `app.bsky.feed.getPosts` names
 * it (and can lag behind a delete), so the record is confirmed on the user's
 * own PDS with `value.subject.uri === postUri` before it is used. A 4xx
 * refusal (other than 429) reads as no record; 5xx and 429 propagate so the
 * change can be retried. `skipUri` (the record just deleted) is not looked up.
 */
const readViewerInteractionUri = async (
  agent: BlueskyAgent,
  postUri: string,
  kind: BlueskyInteractionKind,
  skipUri?: string
): Promise<string | null> => {
  const collection = COLLECTIONS[kind]
  try {
    const response = await agent.get<{
      posts?: Array<{ viewer?: { like?: unknown; repost?: unknown } }>
    }>('app.bsky.feed.getPosts', { uris: [postUri] })
    const uri = response?.posts?.[0]?.viewer?.[kind]
    if (typeof uri !== 'string' || uri.length > MAX_INTERACTION_URI_LENGTH) {
      return null
    }
    const parsed = parseAtUri(uri)
    if (
      uri === skipUri ||
      parsed?.did !== agent.did ||
      parsed.collection !== collection
    ) {
      return null
    }
    const record = await agent.get<{
      value?: { subject?: { uri?: unknown } }
    }>('com.atproto.repo.getRecord', {
      repo: parsed.did,
      collection: parsed.collection,
      rkey: parsed.rkey
    })
    return record?.value?.subject?.uri === postUri ? uri : null
  } catch (error) {
    if (
      !(error instanceof BlueskyRequestError) ||
      error.status < 400 ||
      error.status >= 500 ||
      error.status === 429
    ) {
      throw error
    }
    logger.info({
      message: `Could not read an existing Bluesky ${kind}`,
      err: toLoggableError(error)
    })
    return null
  }
}

const createInteractionRecord = async (
  agent: BlueskyAgent,
  record: BlueskyRecord,
  kind: BlueskyInteractionKind
): Promise<string> => {
  const collection = COLLECTIONS[kind]
  const answer = await agent.post<{ uri?: unknown }>(
    'com.atproto.repo.createRecord',
    {
      repo: agent.did,
      collection,
      record: {
        $type: collection,
        subject: { uri: record.uri, cid: record.cid },
        createdAt: new Date().toISOString()
      }
    }
  )
  const uri = typeof answer?.uri === 'string' ? answer.uri : ''
  const parsed = parseAtUri(uri)
  if (
    uri.length > MAX_INTERACTION_URI_LENGTH ||
    parsed?.did !== agent.did ||
    parsed.collection !== collection
  ) {
    throw new Error('Bluesky createRecord gave an unexpected answer')
  }
  return uri
}

const deleteInteractionRecord = async (
  agent: BlueskyAgent,
  uri: string,
  kind: BlueskyInteractionKind
): Promise<void> => {
  const parsed = parseAtUri(uri)
  // A record in another repo (the account was relinked to a different DID)
  // cannot be deleted with this session: only the local row is ours to drop.
  if (parsed?.did !== agent.did || parsed.collection !== COLLECTIONS[kind]) {
    return
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
}

// Re-checks the linked DID before storing so a relink during a PDS call cannot
// attach an interaction from the old account.
const assertLinkedDid = async (
  database: Database,
  actor: Actor,
  agentDid: string
) => {
  const link = await database.getBlueskyAccount({ actorId: actor.id })
  if (!link) throw new BlueskyActionError(NOT_LINKED)
  if (link.did !== agentDid) throw new BlueskySessionChangedError()
}

const storeLike = async (
  database: Database,
  actor: Actor,
  statusId: string,
  agentDid: string,
  uri: string
): Promise<BlueskyInteraction> => {
  await assertLinkedDid(database, actor, agentDid)
  await database.createBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'like',
    uri
  })
  await database.createLike({ actorId: actor.id, statusId })
  return (await database.getBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'like'
  })) as BlueskyInteraction
}

const ensureLocalRepost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status> => {
  const existingAnnounce = await database.getActorAnnounceStatus({
    statusId,
    actorId: actor.id
  })
  if (existingAnnounce) return existingAnnounce
  const announceStatus = await createLocalAnnounce({
    database,
    currentActor: actor,
    originalStatusId: statusId
  })
  if (!announceStatus) {
    throw new BlueskyActionError('Record not found', 404)
  }
  return announceStatus
}

const storeRepost = async (
  database: Database,
  actor: Actor,
  statusId: string,
  agentDid: string,
  uri: string
): Promise<Status> => {
  await assertLinkedDid(database, actor, agentDid)
  await database.createBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'repost',
    uri
  })
  return ensureLocalRepost(database, actor, statusId)
}

const writeLike = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<BlueskyInteraction> => {
  if (!(await isBlueskyAllowed(database))) {
    throw new BlueskyActionError(BLUESKY_NOT_ALLOWED_MESSAGE)
  }
  const record = await requireBlueskyPostRecord(database, statusId)
  const agent = await requireAgent(database, actor)

  const existing = await database.getBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'like'
  })
  if (existing) {
    await database.createLike({ actorId: actor.id, statusId })
    return existing
  }

  // Adopt a like already in the user's repo instead of writing a duplicate.
  const remoteUri = await readViewerInteractionUri(agent, record.uri, 'like')
  if (remoteUri) {
    return storeLike(database, actor, statusId, agent.did, remoteUri)
  }

  const uri = await createInteractionRecord(agent, record, 'like')
  return storeLike(database, actor, statusId, agent.did, uri)
}

const removeLike = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<void> => {
  const [record, existing] = await Promise.all([
    database.getBlueskyRecordByStatusId({ statusId }),
    database.getBlueskyInteraction({
      actorId: actor.id,
      statusId,
      kind: 'like'
    })
  ])
  if (!existing) {
    if (record) {
      const agent = await getBlueskyAgent(database, actor)
      if (agent) {
        // Remove a like created in another Bluesky app even with no local row.
        const remoteUri = await readViewerInteractionUri(
          agent,
          record.uri,
          'like'
        )
        if (remoteUri) await deleteInteractionRecord(agent, remoteUri, 'like')
      }
    }
    await database.deleteLike({ actorId: actor.id, statusId })
    return
  }

  const agent = await requireAgent(database, actor)
  await deleteInteractionRecord(agent, existing.uri, 'like')
  // Also remove a leftover duplicate like record created before adoption.
  if (record) {
    const leftover = await readViewerInteractionUri(
      agent,
      record.uri,
      'like',
      existing.uri
    )
    if (leftover) await deleteInteractionRecord(agent, leftover, 'like')
  }
  await database.deleteBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'like'
  })
  await database.deleteLike({ actorId: actor.id, statusId })
}

const writeRepost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status> => {
  if (!(await isBlueskyAllowed(database))) {
    throw new BlueskyActionError(BLUESKY_NOT_ALLOWED_MESSAGE)
  }
  const record = await requireBlueskyPostRecord(database, statusId)
  const agent = await requireAgent(database, actor)

  const existing = await database.getBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'repost'
  })
  if (existing) {
    return ensureLocalRepost(database, actor, statusId)
  }

  // Adopt a repost already in the user's repo instead of writing a duplicate.
  const remoteUri = await readViewerInteractionUri(agent, record.uri, 'repost')
  if (remoteUri) {
    return storeRepost(database, actor, statusId, agent.did, remoteUri)
  }

  const uri = await createInteractionRecord(agent, record, 'repost')
  return storeRepost(database, actor, statusId, agent.did, uri)
}

const deleteLocalAnnounce = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status | null> => {
  const localAnnounce = await database.getActorAnnounceStatus({
    statusId,
    actorId: actor.id
  })
  if (localAnnounce) {
    await database.deleteStatus({ statusId: localAnnounce.id })
  }
  return localAnnounce
}

const removeRepost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status | null> => {
  const [record, existing] = await Promise.all([
    database.getBlueskyRecordByStatusId({ statusId }),
    database.getBlueskyInteraction({
      actorId: actor.id,
      statusId,
      kind: 'repost'
    })
  ])
  if (!existing) {
    if (record) {
      const agent = await getBlueskyAgent(database, actor)
      if (agent) {
        // Remove a repost created in another Bluesky app even with no local row.
        const remoteUri = await readViewerInteractionUri(
          agent,
          record.uri,
          'repost'
        )
        if (remoteUri) await deleteInteractionRecord(agent, remoteUri, 'repost')
      }
    }
    return deleteLocalAnnounce(database, actor, statusId)
  }

  const agent = await requireAgent(database, actor)
  await deleteInteractionRecord(agent, existing.uri, 'repost')
  // Also remove a leftover duplicate repost record created before adoption.
  if (record) {
    const leftover = await readViewerInteractionUri(
      agent,
      record.uri,
      'repost',
      existing.uri
    )
    if (leftover) await deleteInteractionRecord(agent, leftover, 'repost')
  }
  await database.deleteBlueskyInteraction({
    actorId: actor.id,
    statusId,
    kind: 'repost'
  })
  return deleteLocalAnnounce(database, actor, statusId)
}

export const likeBlueskyPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<BlueskyInteraction> =>
  withInteractionLock(database, actor, statusId, 'like', () =>
    writeLike(database, actor, statusId)
  )

export const unlikeBlueskyPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<void> =>
  withInteractionLock(database, actor, statusId, 'like', () =>
    removeLike(database, actor, statusId)
  )

export const repostBlueskyPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status> =>
  withInteractionLock(database, actor, statusId, 'repost', () =>
    writeRepost(database, actor, statusId)
  )

export const unrepostBlueskyPost = async (
  database: Database,
  actor: Actor,
  statusId: string
): Promise<Status | null> =>
  withInteractionLock(database, actor, statusId, 'repost', () =>
    removeRepost(database, actor, statusId)
  )

export const blueskyInteractionFailure = (
  error: unknown
): BlueskyActionFailure | null =>
  blueskyActionFailure(error, {
    lockPrefix: BLUESKY_INTERACTION_LOCK_PREFIX,
    busy: BUSY_MESSAGE
  })
