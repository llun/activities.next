// Following a Bluesky account adopts or writes an app.bsky.graph.follow record
// in the user's own PDS; bluesky_follows keeps its at:// URI for unfollowing.
import type { BlueskyFollow } from '@/lib/database/domains/bluesky/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  type BlueskyAgent,
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from './agent'
import { BlueskyLockTimeoutError, createBlueskyLock } from './client'
import { DID_PATTERN, blueskyActorId, parseAtUri } from './records'

const FOLLOW_COLLECTION = 'app.bsky.graph.follow'

export class BlueskyFollowError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 422 = 422
  ) {
    super(message)
    this.name = 'BlueskyFollowError'
  }
}

// The DID of a https://bsky.app/profile/<did> actor id; null for any other
// id under bsky.app (a post id passes isBlueskyId too).
const targetDid = (targetActorId: string) => {
  const did = targetActorId.slice('https://bsky.app/profile/'.length)
  return DID_PATTERN.test(did) && blueskyActorId(did) === targetActorId
    ? did
    : null
}

const NOT_LINKED =
  'Link a Bluesky account in Settings › Other networks to follow Bluesky accounts.'

const requireAgent = async (database: Database, actor: Actor) => {
  const agent = await getBlueskyAgent(database, actor)
  if (!agent) throw new BlueskyFollowError(NOT_LINKED)
  return agent
}

// One follow change per (actor, target) at a time, across instances: a double
// tap must not write two follow records to the PDS.
const FOLLOW_LOCK_PREFIX = 'bluesky-follow:'

const withFollowLock = <T>(
  database: Database,
  actor: Actor,
  targetActorId: string,
  fn: () => Promise<T>
) =>
  createBlueskyLock(database)(
    `${FOLLOW_LOCK_PREFIX}${actor.id}:${targetActorId}`,
    fn
  )

// bluesky_follows.uri is varchar(512).
const MAX_FOLLOW_URI_LENGTH = 512

/**
 * The user's existing follow record of `did` (say, made in another app), or
 * null. Best effort: the AppView's viewer state names it (and lags behind a
 * delete, and answers 400 for a deactivated or deleted account), so the record
 * is confirmed on the user's own PDS, following `did`, before it is used, and
 * any refused lookup reads as no record rather than failing the change.
 */
const readViewerFollowUri = async (
  agent: BlueskyAgent,
  did: string
): Promise<string | null> => {
  try {
    const profile = await agent.get<{ viewer?: { following?: unknown } }>(
      'app.bsky.actor.getProfile',
      { actor: did }
    )
    const uri = profile?.viewer?.following
    if (typeof uri !== 'string' || uri.length > MAX_FOLLOW_URI_LENGTH) {
      return null
    }
    const parsed = parseAtUri(uri)
    if (parsed?.did !== agent.did || parsed.collection !== FOLLOW_COLLECTION) {
      return null
    }
    const record = await agent.get<{ value?: { subject?: unknown } }>(
      'com.atproto.repo.getRecord',
      { repo: parsed.did, collection: parsed.collection, rkey: parsed.rkey }
    )
    return record?.value?.subject === did ? uri : null
  } catch (error) {
    if (!(error instanceof BlueskyRequestError)) throw error
    logger.info({
      message: 'Could not read an existing Bluesky follow',
      err: toLoggableError(error)
    })
    return null
  }
}

// Re-checks the linked DID before storing so a relink during a PDS call cannot
// attach a follow from the old account.
// shortcut: a relink between this check and the insert still slips through;
// take the follow lock in relink if that ever shows up.
const storeFollow = async (
  database: Database,
  actor: Actor,
  targetActorId: string,
  agentDid: string,
  uri: string
): Promise<BlueskyFollow> => {
  const link = await database.getBlueskyAccount({ actorId: actor.id })
  if (!link) throw new BlueskyFollowError(NOT_LINKED)
  if (link.did !== agentDid) throw new BlueskySessionChangedError()
  await database.createBlueskyFollow({ actorId: actor.id, targetActorId, uri })
  return (await database.getBlueskyFollow({
    actorId: actor.id,
    targetActorId
  })) as BlueskyFollow
}

const deleteFollowRecord = async (agent: BlueskyAgent, uri: string) => {
  const parsed = parseAtUri(uri)
  // A record in another repo (the account was relinked to a different DID)
  // cannot be deleted with this session: only the row is ours to drop.
  if (parsed?.did !== agent.did || parsed.collection !== FOLLOW_COLLECTION) {
    return
  }
  try {
    await agent.post('com.atproto.repo.deleteRecord', {
      repo: parsed.did,
      collection: parsed.collection,
      rkey: parsed.rkey
    })
  } catch (error) {
    // Already deleted on Bluesky (from another app): only the row is left.
    if (
      !(error instanceof BlueskyRequestError) ||
      error.error !== 'RecordNotFound'
    ) {
      throw error
    }
  }
}

const writeFollow = async (
  database: Database,
  actor: Actor,
  targetActorId: string
): Promise<BlueskyFollow> => {
  const did = targetDid(targetActorId)
  if (!did || !(await database.getActorFromId({ id: targetActorId }))) {
    throw new BlueskyFollowError('Record not found', 404)
  }
  const agent = await requireAgent(database, actor)
  if (did === agent.did) {
    throw new BlueskyFollowError('You cannot follow your own Bluesky account.')
  }

  const existing = await database.getBlueskyFollow({
    actorId: actor.id,
    targetActorId
  })
  if (existing) return existing

  // Adopt a follow already in the user's repo instead of writing a duplicate.
  const remoteUri = await readViewerFollowUri(agent, did)
  if (remoteUri) {
    return storeFollow(database, actor, targetActorId, agent.did, remoteUri)
  }

  const answer = await agent.post<{ uri?: unknown }>(
    'com.atproto.repo.createRecord',
    {
      repo: agent.did,
      collection: FOLLOW_COLLECTION,
      record: {
        $type: FOLLOW_COLLECTION,
        subject: did,
        createdAt: new Date().toISOString()
      }
    }
  )
  const uri = typeof answer?.uri === 'string' ? answer.uri : ''
  const parsed = parseAtUri(uri)
  if (parsed?.did !== agent.did || parsed.collection !== FOLLOW_COLLECTION) {
    throw new Error('Bluesky createRecord gave an unexpected answer')
  }
  return storeFollow(database, actor, targetActorId, agent.did, uri)
}

const deleteFollow = async (
  database: Database,
  actor: Actor,
  targetActorId: string
): Promise<void> => {
  const did = targetDid(targetActorId)
  const existing = await database.getBlueskyFollow({
    actorId: actor.id,
    targetActorId
  })
  if (!existing) {
    if (!did || !(await database.getActorFromId({ id: targetActorId }))) return
    const agent = await getBlueskyAgent(database, actor)
    if (!agent) return
    // Remove a follow created in another Bluesky app even with no local row.
    const remoteUri = await readViewerFollowUri(agent, did)
    if (remoteUri) await deleteFollowRecord(agent, remoteUri)
    return
  }
  const agent = await requireAgent(database, actor)
  await deleteFollowRecord(agent, existing.uri)
  // Also remove a leftover duplicate follow record created before adoption.
  if (did) {
    const leftover = await readViewerFollowUri(agent, did)
    if (leftover && leftover !== existing.uri) {
      await deleteFollowRecord(agent, leftover)
    }
  }
  await database.deleteBlueskyFollow({ actorId: actor.id, targetActorId })
}

export const followBlueskyActor = async (
  database: Database,
  actor: Actor,
  targetActorId: string
): Promise<BlueskyFollow> =>
  withFollowLock(database, actor, targetActorId, () =>
    writeFollow(database, actor, targetActorId)
  )

export const unfollowBlueskyActor = async (
  database: Database,
  actor: Actor,
  targetActorId: string
): Promise<void> =>
  withFollowLock(database, actor, targetActorId, () =>
    deleteFollow(database, actor, targetActorId)
  )

/**
 * The status and `{ error }` message the follow routes answer for a failure,
 * or null for an error they should not catch.
 */
export const blueskyFollowFailure = (
  error: unknown
): { status: 404 | 409 | 422 | 502; error: string } | null => {
  if (error instanceof BlueskyFollowError) {
    return { status: error.status, error: error.message }
  }
  // Only the follow lock: a session-refresh lock timing out is not a follow
  // change in progress.
  if (
    error instanceof BlueskyLockTimeoutError &&
    error.lockName.startsWith(FOLLOW_LOCK_PREFIX)
  ) {
    return {
      status: 409,
      error:
        'Another follow change for this account is in progress. Try again in a moment.'
    }
  }
  if (error instanceof BlueskySessionChangedError) {
    return {
      status: 409,
      error: 'Your Bluesky account was just linked again. Try again.'
    }
  }
  if (error instanceof BlueskySessionEndedError) {
    return {
      status: 422,
      error: 'Bluesky ended this session. Link the account again in Settings.'
    }
  }
  if (error instanceof BlueskyRequestError) {
    logger.warn({
      message: 'Bluesky refused a follow change',
      err: toLoggableError(error)
    })
    return {
      status: 502,
      error: 'Bluesky did not accept the change. Please try again.'
    }
  }
  return null
}
