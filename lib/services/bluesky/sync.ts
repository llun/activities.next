// Pulls the Bluesky Home timeline of an actor's linked account into this
// server: each post and its author are stored as `network = 'bluesky'` rows
// and the post is added to the actor's Home. Run by syncBlueskyHomeJob.
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
import {
  blueskyImagesFromEmbed,
  blueskyPostToHtml,
  parseAtUri
} from './records'

const PAGE_LIMIT = 50
const MAX_PAGES = 3
const POST_COLLECTION = 'app.bsky.feed.post'
const REPOST_REASON = 'app.bsky.feed.defs#reasonRepost'

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null

const optionalString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

// A post view (app.bsky.feed.defs#postView) whose record is a post; null for
// anything else (a not-found or blocked parent, another record type).
const asPostView = (value: unknown) => {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.record)) {
    return null
  }
  const { uri, cid, author, record } = value
  if (
    typeof uri !== 'string' ||
    typeof cid !== 'string' ||
    typeof author.did !== 'string' ||
    typeof author.handle !== 'string' ||
    record.$type !== POST_COLLECTION
  ) {
    return null
  }
  const at = parseAtUri(uri)
  if (!at || at.collection !== POST_COLLECTION || at.did !== author.did) {
    return null
  }
  return { uri, cid, at, author, record, value }
}

type PostView = NonNullable<ReturnType<typeof asPostView>>

const storePost = async (
  database: Database,
  post: PostView,
  replyToStatusId?: string
): Promise<string | null> => {
  const { author, record } = post
  // The feed's author view carries no description or banner: undefined keeps
  // what a fuller profile fetch stored.
  const actorId = await database.upsertBlueskyActor({
    did: author.did as string,
    handle: author.handle as string,
    name: optionalString(author.displayName) ?? null,
    summary: optionalString(author.description),
    iconUrl: optionalString(author.avatar) ?? null,
    headerImageUrl: optionalString(author.banner)
  })
  if (!actorId) return null
  const now = Date.now()
  const createdAt =
    Date.parse(optionalString(record.createdAt) ?? '') ||
    Date.parse(optionalString(post.value.indexedAt) ?? '') ||
    now
  const { statusId } = await database.upsertBlueskyPost({
    uri: post.uri,
    cid: post.cid,
    did: post.at.did,
    rkey: post.at.rkey,
    actorId,
    text: blueskyPostToHtml(optionalString(record.text) ?? '', record.facets),
    // A clock ahead of ours must not pin the post to the top of Home.
    createdAt: Math.min(createdAt, now),
    replyToStatusId,
    attachments: blueskyImagesFromEmbed(post.value.embed)
  })
  return statusId
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
    const items: Json[] = []
    let cursor: string | undefined
    pages: for (let page = 0; page < MAX_PAGES; page++) {
      const response = await agent.get<{ feed?: unknown; cursor?: unknown }>(
        'app.bsky.feed.getTimeline',
        { limit: PAGE_LIMIT, cursor }
      )
      const feed = Array.isArray(response?.feed) ? response.feed : []
      for (const item of feed) {
        if (!isRecord(item)) continue
        const post = asPostView(item.post)
        // A repost of an older post says nothing about where the last sync
        // stopped, so only an original post ends the walk.
        const repost =
          isRecord(item.reason) && item.reason.$type === REPOST_REASON
        if (
          post &&
          !repost &&
          (await database.getBlueskyRecordByUri({ uri: post.uri }))
        ) {
          break pages
        }
        items.push(item)
      }
      cursor = optionalString(response?.cursor)
      if (!cursor || feed.length === 0) break
    }

    // Oldest first, so Home gets them in the order they were posted.
    for (const item of items.reverse()) {
      const post = asPostView(item.post)
      if (!post) continue
      // A repost shows the original post; there is no boost row for it yet.
      const parent = isRecord(item.reply) ? asPostView(item.reply.parent) : null
      const replyToStatusId = parent
        ? ((await storePost(database, parent)) ?? undefined)
        : undefined
      const statusId = await storePost(database, post, replyToStatusId)
      if (!statusId) continue
      const status = await database.getStatus({ statusId })
      if (!status) continue
      await database.createTimelineStatus({
        actorId: actor.id,
        status,
        timeline: Timeline.MAIN
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
