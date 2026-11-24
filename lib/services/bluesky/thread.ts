// Loads the conversation (ancestors and replies) around a stored Bluesky post
// from the public AppView so status context views show the thread.
//
// Only a signed-in viewer with a linked Bluesky account (on a server that
// allows Bluesky) makes this server contact Bluesky. Reads are rate-limited
// per post and never throw to the caller.
import crypto from 'node:crypto'

import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { getPublicPostThread } from './appview'
import { claimAppViewRead, hasLinkedAccount } from './profiles'
import {
  type BlueskyPostView,
  parseAtUri,
  parseBlueskyPostView,
  storeBlueskyPostView
} from './records'

const POST_COLLECTION = 'app.bsky.feed.post'
const THREAD_VIEW_POST_TYPE = 'app.bsky.feed.defs#threadViewPost'
const THREAD_DEPTH = 6
const THREAD_PARENT_HEIGHT = 20
// Cap the posts stored from one thread fetch so a viral thread cannot trigger
// unbounded writes during a single context or page request.
const MAX_THREAD_POSTS = 200
export const BLUESKY_THREAD_VIEWER_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60 * 1000
}

const isThreadViewPost = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  (value.$type === undefined || value.$type === THREAD_VIEW_POST_TYPE) &&
  isRecord(value.post)

/**
 * Fetches `app.bsky.feed.getPostThread` from the public AppView for a stored
 * Bluesky post (for a viewer with a linked account, rate-limited per post) and
 * stores every parent and reply post with `storeBlueskyPostView`. Best-effort:
 * logs failures and never throws.
 */
export const loadBlueskyThread = async (
  database: Database,
  viewer: Actor,
  statusId: string
): Promise<void> => {
  if (!isBlueskyId(statusId)) return
  try {
    const record = await database.getBlueskyRecordByStatusId({ statusId })
    if (!record) return
    const at = parseAtUri(record.uri)
    if (!at || at.collection !== POST_COLLECTION) return
    if (!(await hasLinkedAccount(database, viewer))) return
    const viewerDigest = crypto
      .createHash('sha256')
      .update(viewer.id)
      .digest('hex')
    const viewerBudget = await database.consumeRateLimit({
      key: `${APP_RATE_LIMIT_KEY_PREFIX}bluesky-thread-viewer:${viewerDigest}`,
      keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
      ...BLUESKY_THREAD_VIEWER_RATE_LIMIT
    })
    if (!viewerBudget.allowed) return
    if (!(await claimAppViewRead(database, 'thread', statusId))) return

    const response = await getPublicPostThread(record.uri, {
      depth: THREAD_DEPTH,
      parentHeight: THREAD_PARENT_HEIGHT
    })
    const root = response?.thread
    if (!isThreadViewPost(root)) return
    const rootPost = parseBlueskyPostView(root.post)
    if (!rootPost || rootPost.uri !== record.uri) return

    const seen = new Set<string>([rootPost.uri])
    const parents: BlueskyPostView[] = []
    let currentParent: unknown = root.parent
    for (let height = 0; height < THREAD_PARENT_HEIGHT; height++) {
      if (!isThreadViewPost(currentParent)) break
      const post = parseBlueskyPostView(currentParent.post)
      if (!post || seen.has(post.uri)) break
      seen.add(post.uri)
      parents.push(post)
      currentParent = currentParent.parent
    }
    parents.reverse()

    const replies: BlueskyPostView[] = []
    const queue: { node: unknown; depth: number }[] = []
    if (Array.isArray(root.replies)) {
      for (const reply of root.replies) {
        queue.push({ node: reply, depth: 1 })
      }
    }
    for (let index = 0; index < queue.length; index++) {
      if (parents.length + replies.length >= MAX_THREAD_POSTS) break
      const { node, depth } = queue[index]
      if (!isThreadViewPost(node)) continue
      const post = parseBlueskyPostView(node.post)
      if (!post || seen.has(post.uri)) continue
      seen.add(post.uri)
      replies.push(post)
      if (depth < THREAD_DEPTH && Array.isArray(node.replies)) {
        for (const child of node.replies) {
          queue.push({ node: child, depth: depth + 1 })
        }
      }
    }

    for (const post of [...parents, ...replies]) {
      try {
        await storeBlueskyPostView(database, post)
      } catch (error) {
        logger.warn({
          message: 'Skipped a Bluesky thread post that could not be stored',
          statusId,
          uri: post.uri,
          err: toLoggableError(error)
        })
      }
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to load Bluesky thread',
      statusId,
      err: toLoggableError(error)
    })
  }
}
