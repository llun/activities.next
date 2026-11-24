// Pulls the Bluesky Home timeline of an actor's linked account into this
// server: each post and its author are stored as `network = 'bluesky'` rows
// and the post is added to the actor's Home. Run by syncBlueskyHomeJob.
//
// The rows are shared by every user, so the user's PDS only says which posts
// are in that user's Home; what is stored is read from the public AppView
// (./appview), never from the PDS's answer.
import crypto from 'node:crypto'

import type { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import type { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import {
  BlueskyRequestError,
  BlueskySessionChangedError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from './agent'
import { getPublicPosts } from './appview'
import { syncBlueskyNotifications } from './notifications'
import { BLUESKY_NOT_ALLOWED_MESSAGE, isBlueskyAllowed } from './policy'
import {
  type BlueskyPostView,
  blueskyPostId,
  optionalString,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyPostView
} from './records'

const PAGE_LIMIT = 50
const MAX_PAGES = 3
const POST_COLLECTION = 'app.bsky.feed.post'
const REPOST_REASON = 'app.bsky.feed.defs#reasonRepost'
// One sweep interval: a crashed holder blocks the actor's sync no longer.
const SYNC_LOCK_TTL_MS = 5 * 60 * 1000

// One Home entry as the PDS lists it: the post, and when it was reposted.
type HomeItem = { uri: string; repostedAt?: number }

// The AppView's views of `uris`, keyed by uri; a post it does not return is
// missing.
const readPublicPosts = async (uris: string[]) => {
  const views = new Map<string, BlueskyPostView>()
  if (uris.length === 0) return views
  for (const value of await getPublicPosts(uris)) {
    const post = parseBlueskyPostView(value)
    if (post) views.set(post.uri, post)
  }
  return views
}

const parentUri = (post: BlueskyPostView) => {
  const { reply } = post.record
  if (!isRecord(reply) || !isRecord(reply.parent)) return undefined
  return optionalString(reply.parent.uri)
}

const syncErrorMessage = (error: unknown) => {
  if (error instanceof BlueskySessionEndedError) {
    return 'Bluesky ended this session.'
  }
  if (error instanceof BlueskyRequestError) {
    return `Bluesky refused the request (${error.status}). Trying again in a few minutes.`
  }
  return 'Home sync failed. Trying again in a few minutes.'
}

/**
 * Stores the newest posts of the actor's Bluesky Home (up to three pages,
 * stopping at a post already in this actor's Home) and adds them to the
 * actor's Home. Records the outcome on the linked account and never throws for
 * a remote failure: Settings shows the error and the next sync tries again.
 * Skips the run while another one for the same actor holds its lock, on any
 * instance.
 */
export const syncBlueskyHome = async (
  database: Database,
  actor: Actor
): Promise<void> => {
  const lockKey = `bluesky-sync:${crypto.createHash('sha256').update(actor.id).digest('hex')}`
  const lock = await database.acquireImportLock({
    lockKey,
    ttlMs: SYNC_LOCK_TTL_MS
  })
  if (!lock) return
  try {
    await runSync(database, actor)
  } finally {
    await database.releaseImportLock({ lockKey, token: lock.token })
  }
}

// Stores one Home entry and adds it to the actor's Home, dropping any boost
// (Announce) of the same post from that Home so the original wins and undoing
// the boost later leaves the post in Home.
const storeHomeItem = async (
  database: Database,
  actor: Actor,
  item: HomeItem,
  post: BlueskyPostView
) => {
  // The Bluesky copy of a local post: the local post is already in Home.
  if (await database.getBlueskyCrosspostByUri({ uri: post.uri })) return
  const statusId = await storeBlueskyPostView(database, post)
  if (!statusId) return
  const status = await database.getStatus({ statusId })
  if (!status) return
  await database.createTimelineStatus({
    actorId: actor.id,
    status,
    timeline: Timeline.MAIN,
    // A repost sits in Home at the time it was reposted.
    ...(item.repostedAt
      ? { createdAt: Math.min(item.repostedAt, Date.now()) }
      : null)
  })
  await database.removeBoostsOfStatusFromHome({
    actorId: actor.id,
    statusId
  })
}

const runSync = async (database: Database, actor: Actor) => {
  try {
    if (!(await isBlueskyAllowed(database))) {
      await database.updateBlueskyAccountSync({
        actorId: actor.id,
        syncError: BLUESKY_NOT_ALLOWED_MESSAGE
      })
      return
    }
    const agent = await getBlueskyAgent(database, actor)
    // No link, or no session to use: Settings already says so.
    if (!agent) return
    const items: HomeItem[] = []
    let cursor: string | undefined
    pages: for (let page = 0; page < MAX_PAGES; page++) {
      const response = await agent.get<{ feed?: unknown; cursor?: unknown }>(
        'app.bsky.feed.getTimeline',
        { limit: PAGE_LIMIT, cursor }
      )
      // A PDS may answer more than it was asked for.
      const feed = (Array.isArray(response?.feed) ? response.feed : []).slice(
        0,
        PAGE_LIMIT
      )
      for (const item of feed) {
        if (!isRecord(item) || !isRecord(item.post)) continue
        const uri = optionalString(item.post.uri)
        const at = uri ? parseAtUri(uri) : null
        if (!uri || at?.collection !== POST_COLLECTION) continue
        // A repost of an older post says nothing about where the last sync
        // stopped, so only an original post ends the walk. The posts are
        // shared rows (another user's Home, a reply's parent, a profile), so
        // only one already in this actor's Home says this sync got there.
        // A boost (Announce) of a post can enter Home out-of-band (a local
        // repost or a fanned-out boost) before sync reaches older posts, so it
        // does not stop the walk; once sync adds the original post,
        // storeHomeItem removes any boost row of it from this actor's Home.
        const reason = isRecord(item.reason) ? item.reason : null
        const repost = reason?.$type === REPOST_REASON
        if (
          !repost &&
          (await database.isBlueskyPostInHome({
            actorId: actor.id,
            statusId: blueskyPostId(at.did, at.rkey)
          }))
        ) {
          break pages
        }
        items.push({
          uri,
          repostedAt: repost
            ? Date.parse(optionalString(reason?.indexedAt) ?? '') || undefined
            : undefined
        })
      }
      cursor = optionalString(response?.cursor)
      if (!cursor || feed.length === 0) break
    }

    // A post the AppView does not return (deleted, blocked) is dropped. The
    // parents of replies come from the AppView's own records.
    const views = await readPublicPosts(items.map((item) => item.uri))
    const parents = await readPublicPosts(
      [...views.values()]
        .map(parentUri)
        .filter((uri): uri is string => !!uri && !views.has(uri))
    )

    // One post that cannot be stored must not cost the rest of the Home.
    // It is never in Home, so the next sync does not stop at it either.
    const skipOnError = async (uri: string, store: () => Promise<unknown>) => {
      try {
        await store()
      } catch (error) {
        logger.warn({
          message: 'Skipped a Bluesky post that could not be stored',
          actorId: actor.id,
          uri,
          err: toLoggableError(error)
        })
      }
    }
    // Oldest first, so Home gets them in the order they were posted.
    for (const item of items.reverse()) {
      const post = views.get(item.uri)
      if (!post) continue
      const parent = parentUri(post)
      const parentView = parent
        ? (views.get(parent) ?? parents.get(parent))
        : undefined
      // A reply to the user's cross-post goes under the local post itself.
      if (
        parentView &&
        !(await database.getBlueskyCrosspostByUri({ uri: parentView.uri }))
      ) {
        await skipOnError(parentView.uri, () =>
          storeBlueskyPostView(database, parentView)
        )
      }
      await skipOnError(item.uri, () =>
        storeHomeItem(database, actor, item, post)
      )
    }
    const homeSyncedAt = Date.now()
    try {
      await syncBlueskyNotifications(database, actor, agent)
    } catch (error) {
      if (error instanceof BlueskySessionChangedError) {
        logger.info({
          message: 'Bluesky notification sync stopped by a relink',
          actorId: actor.id
        })
        return
      }
      if (error instanceof BlueskySessionEndedError) {
        throw error
      }
      const syncError =
        'Bluesky notifications could not be read. Trying again in a few minutes.'
      logger.warn({
        message: 'Bluesky notification sync failed',
        actorId: actor.id,
        error: syncError,
        err: toLoggableError(error)
      })
      await database.updateBlueskyAccountSync({
        actorId: actor.id,
        lastSyncedAt: homeSyncedAt,
        syncError
      })
      return
    }
    await database.updateBlueskyAccountSync({
      actorId: actor.id,
      lastSyncedAt: homeSyncedAt,
      syncError: null
    })
  } catch (error) {
    // Relinked while this run worked: the new link starts clean and its own
    // sync comes on the next sweep, so leave no error on it.
    if (error instanceof BlueskySessionChangedError) {
      logger.info({
        message: 'Bluesky Home sync stopped by a relink',
        actorId: actor.id
      })
      return
    }
    const syncError = syncErrorMessage(error)
    const log =
      error instanceof BlueskySessionEndedError ? logger.info : logger.warn
    log({
      message: 'Bluesky Home sync failed',
      actorId: actor.id,
      error: syncError,
      err: toLoggableError(error)
    })
    await database.updateBlueskyAccountSync({ actorId: actor.id, syncError })
  }
}
