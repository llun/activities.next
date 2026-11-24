// Pulls the Bluesky Home timeline of an actor's linked account into this
// server: each post and its author are stored as `network = 'bluesky'` rows
// and the post is added to the actor's Home. Run by syncBlueskyHomeJob.
//
// The rows are shared by every user, so the user's PDS only says which posts
// are in that user's Home; what is stored is read from the public AppView
// (./appview), never from the PDS's answer.
import type { Database } from '@/lib/database/types'
import { Timeline } from '@/lib/services/timelines/types'
import type { Actor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import {
  BlueskyRequestError,
  BlueskySessionEndedError,
  getBlueskyAgent
} from './agent'
import { getPublicPosts } from './appview'
import {
  type BlueskyPostView,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyPostView
} from './records'

const PAGE_LIMIT = 50
const MAX_PAGES = 3
const POST_COLLECTION = 'app.bsky.feed.post'
const REPOST_REASON = 'app.bsky.feed.defs#reasonRepost'

type Json = Record<string, unknown>
// One Home entry as the PDS lists it: the post, and when it was reposted.
type HomeItem = { uri: string; repostedAt?: number }

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null

const optionalString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

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
 * stopping at a post an earlier sync stored) and adds them to the actor's
 * Home. Records the outcome on the linked account and never throws for a
 * remote failure: Settings shows the error and the next sync tries again.
 */
export const syncBlueskyHome = async (
  database: Database,
  actor: Actor
): Promise<void> => {
  try {
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
      const feed = Array.isArray(response?.feed) ? response.feed : []
      for (const item of feed) {
        if (!isRecord(item) || !isRecord(item.post)) continue
        const uri = optionalString(item.post.uri)
        if (!uri || parseAtUri(uri)?.collection !== POST_COLLECTION) continue
        // A repost of an older post says nothing about where the last sync
        // stopped, so only an original post ends the walk.
        const reason = isRecord(item.reason) ? item.reason : null
        const repost = reason?.$type === REPOST_REASON
        if (!repost && (await database.getBlueskyRecordByUri({ uri }))) {
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

    const now = Date.now()
    // Oldest first, so Home gets them in the order they were posted.
    for (const item of items.reverse()) {
      const post = views.get(item.uri)
      if (!post) continue
      const parent = parentUri(post)
      const parentView = parent
        ? (views.get(parent) ?? parents.get(parent))
        : undefined
      if (parentView) await storeBlueskyPostView(database, parentView)
      // A repost shows the original post; there is no boost row for it yet.
      const statusId = await storeBlueskyPostView(database, post)
      if (!statusId) continue
      const status = await database.getStatus({ statusId })
      if (!status) continue
      await database.createTimelineStatus({
        actorId: actor.id,
        status,
        timeline: Timeline.MAIN,
        // A repost sits in Home at the time it was reposted.
        ...(item.repostedAt
          ? { createdAt: Math.min(item.repostedAt, now) }
          : null)
      })
    }
    await database.updateBlueskyAccountSync({
      actorId: actor.id,
      lastSyncedAt: Date.now(),
      syncError: null
    })
  } catch (error) {
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
