// Bluesky profiles: resolving a handle, DID or bsky.app link to a stored
// actor, refreshing that actor, and storing its recent posts for the profile
// page. What is stored is read from the public AppView (./appview), never from
// a user's PDS; only a viewer with a linked Bluesky account makes this server
// fetch anything.
import crypto from 'node:crypto'

import { APP_RATE_LIMIT_KEY_PREFIX } from '@/lib/database/domains/rateLimit/types'
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import {
  BLUESKY_DID_PATTERN,
  parseBlueskyActorQuery
} from '@/lib/utils/accountHandle'
import {
  BLUESKY_DOMAIN,
  BLUESKY_PROFILE_PREFIX,
  isBlueskyId
} from '@/lib/utils/blueskyId'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'
import { isRecord } from '@/lib/utils/typeGuards'

import { getPublicAuthorFeed, getPublicProfile } from './appview'
import { isBlueskyAllowed } from './policy'
import {
  blueskyActorId,
  parseBlueskyPostView,
  storeBlueskyAuthor,
  storeBlueskyPostView
} from './records'

const REFRESH_INTERVAL_MS = 10 * 60 * 1000
const MAX_FEED_LIMIT = 100
export const BLUESKY_AUTHOR_FEED_VIEWER_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60 * 1000
}

type Json = Record<string, unknown>

// The owner's rule: only a viewer with a linked Bluesky account (on a server
// that allows Bluesky) makes this server contact Bluesky for a profile.
export const hasLinkedAccount = async (database: Database, viewer: Actor) =>
  (await isBlueskyAllowed(database)) &&
  !!(await database.getBlueskyAccount({ actorId: viewer.id }))

/**
 * The handle or DID a query names: a handle (`alice.bsky.social`,
 * `@alice.bsky.social`, `alice.bsky.social@bsky.app`), a DID, or a
 * `https://bsky.app/profile/<handle-or-did>` link. Null for anything else,
 * which is never fetched.
 */
export const parseBlueskyProfileInput = (input: string): string | null => {
  const value = input.trim().replace(/^@/, '')
  if (BLUESKY_DID_PATTERN.test(value)) return value
  const suffix = `@${BLUESKY_DOMAIN}`
  return parseBlueskyActorQuery(
    value.toLowerCase().endsWith(suffix)
      ? value.slice(0, -suffix.length)
      : value
  )
}

// Stores the AppView's profile of `actor` when the answer is the account that
// was asked for; null otherwise.
const fetchProfile = async (
  database: Database,
  actor: string
): Promise<string | null> => {
  const profile = await getPublicProfile(actor)
  if (!isRecord(profile)) return null
  const { did, handle } = profile
  if (
    typeof did !== 'string' ||
    (actor !== did &&
      (typeof handle !== 'string' || actor !== handle.toLowerCase()))
  ) {
    return null
  }
  return storeBlueskyAuthor(database, profile, { full: true })
}

const logFailure = (message: string, err: unknown, extra: Json) => {
  logger.warn({ message, ...extra, err: toLoggableError(err) })
}

/**
 * The stored actor id of the Bluesky account `input` names, fetched from the
 * AppView when it is not stored yet. A stored one is refreshed at most every
 * ten minutes. Null when the input is not a Bluesky
 * handle, DID or link, the viewer has no linked account, or Bluesky has no
 * such account.
 */
export const resolveBlueskyProfile = async (
  database: Database,
  viewer: Actor,
  input: string
): Promise<string | null> => {
  const actor = parseBlueskyProfileInput(input)
  if (!actor) return null
  const stored = actor.startsWith('did:')
    ? await database.getActorFromId({ id: blueskyActorId(actor) })
    : await database.getActorFromUsername({
        username: actor,
        domain: BLUESKY_DOMAIN
      })
  if (stored && isBlueskyId(stored.id)) {
    await refreshBlueskyProfile(database, viewer, stored.id)
    return stored.id
  }
  try {
    if (!(await hasLinkedAccount(database, viewer))) return null
    return await fetchProfile(database, actor)
  } catch (error) {
    logFailure('Failed to resolve Bluesky profile', error, { actor })
    return null
  }
}

// One AppView read of each kind per Bluesky target per window, whoever views
// it; a refused read shows what is stored. updatedAt alone cannot throttle the
// profile read: an unchanged profile does not move it.
export const claimAppViewRead = async (
  database: Database,
  kind: 'feed' | 'profile' | 'thread',
  targetId: string
) => {
  const digest = crypto.createHash('sha256').update(targetId).digest('hex')
  const { allowed } = await database.consumeRateLimit({
    key: `${APP_RATE_LIMIT_KEY_PREFIX}bluesky-${kind}:${digest}`,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    limit: 1,
    windowMs: REFRESH_INTERVAL_MS
  })
  return allowed
}

/**
 * Refreshes a stored Bluesky actor from the AppView for a viewer with a
 * linked account, at most once per ten minutes per actor, counted from
 * the row's last change and from the last read. Best-effort: a failure keeps the stored row.
 */
export const refreshBlueskyProfile = async (
  database: Database,
  viewer: Actor,
  actorId: string
): Promise<void> => {
  if (!actorId.startsWith(BLUESKY_PROFILE_PREFIX)) return
  const did = actorId.slice(BLUESKY_PROFILE_PREFIX.length)
  if (!BLUESKY_DID_PATTERN.test(did)) return
  const stored = await database.getActorFromId({ id: actorId })
  if (!stored || Date.now() - stored.updatedAt < REFRESH_INTERVAL_MS) return
  try {
    if (
      (await hasLinkedAccount(database, viewer)) &&
      (await claimAppViewRead(database, 'profile', actorId))
    ) {
      await fetchProfile(database, did)
    }
  } catch (error) {
    logFailure('Failed to refresh Bluesky profile', error, { actorId })
  }
}

/**
 * Stores the newest posts of a stored Bluesky actor (the AppView's
 * app.bsky.feed.getAuthorFeed, for a viewer with a linked account, at most
 * once per ten minutes per actor and 30 distinct authors per 15 minutes per
 * viewer) for its profile page. Reposts and posts by anyone else are skipped,
 * and nothing is added to a Home timeline.
 */
export const loadBlueskyAuthorFeed = async (
  database: Database,
  viewer: Actor,
  actorId: string,
  { limit }: { limit: number }
): Promise<void> => {
  if (!actorId.startsWith(BLUESKY_PROFILE_PREFIX)) return
  const did = actorId.slice(BLUESKY_PROFILE_PREFIX.length)
  if (!BLUESKY_DID_PATTERN.test(did)) return
  if (!(await hasLinkedAccount(database, viewer))) return
  if (!(await claimAppViewRead(database, 'feed', actorId))) return
  const viewerDigest = crypto
    .createHash('sha256')
    .update(viewer.id)
    .digest('hex')
  const viewerBudget = await database.consumeRateLimit({
    key: `${APP_RATE_LIMIT_KEY_PREFIX}bluesky-feed-viewer:${viewerDigest}`,
    keyPrefix: APP_RATE_LIMIT_KEY_PREFIX,
    ...BLUESKY_AUTHOR_FEED_VIEWER_RATE_LIMIT
  })
  if (!viewerBudget.allowed) return
  const response = await getPublicAuthorFeed(did, {
    limit: Math.min(Math.max(limit, 1), MAX_FEED_LIMIT)
  })
  const feed = Array.isArray(response?.feed) ? response.feed : []
  for (const item of feed) {
    if (!isRecord(item) || item.reason) continue
    const post = parseBlueskyPostView(item.post)
    if (!post || post.at.did !== did) continue
    await storeBlueskyPostView(database, post)
  }
}
