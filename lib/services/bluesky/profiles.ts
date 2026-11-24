// Bluesky profiles opened through a viewer's linked account: resolving a
// handle, DID or bsky.app link to a stored actor, refreshing that actor, and
// storing its recent posts for the profile page. Every call goes through the
// viewer's own agent, so a viewer without a linked account fetches nothing.
import type { Database } from '@/lib/database/types'
import type { Actor } from '@/lib/types/domain/actor'
import {
  BLUESKY_DID_PATTERN,
  parseBlueskyActorQuery
} from '@/lib/utils/accountHandle'
import { isBlueskyId } from '@/lib/utils/blueskyId'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

import { type BlueskyAgent, getBlueskyAgent } from './agent'
import {
  blueskyActorId,
  blueskyImagesFromEmbed,
  blueskyPostId,
  blueskyPostToHtml,
  parseAtUri
} from './records'

const BLUESKY_DOMAIN = 'bsky.app'
const PROFILE_PREFIX = `https://${BLUESKY_DOMAIN}/profile/`
const POST_COLLECTION = 'app.bsky.feed.post'
const REFRESH_INTERVAL_MS = 10 * 60 * 1000
const MAX_FEED_LIMIT = 100

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null

const optionalString = (value: unknown) =>
  typeof value === 'string' ? value : undefined

const optionalCount = (value: unknown) =>
  Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined

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

// Stores an app.bsky.actor.defs#profileViewDetailed when it is the account
// that was asked for; null otherwise.
const storeProfile = async (
  database: Database,
  requested: string,
  profile: unknown
): Promise<string | null> => {
  if (!isRecord(profile)) return null
  const did = optionalString(profile.did)
  const handle = optionalString(profile.handle)?.toLowerCase()
  // The answer names its own account: it must be the one asked for, and a
  // handle Bluesky could not verify (`handle.invalid`) is not stored.
  if (
    !did ||
    !BLUESKY_DID_PATTERN.test(did) ||
    !handle ||
    parseBlueskyActorQuery(handle) !== handle ||
    handle === 'handle.invalid' ||
    (requested !== did && requested.toLowerCase() !== handle)
  ) {
    return null
  }
  const description = optionalString(profile.description)
  return database.upsertBlueskyActor({
    did,
    handle,
    name: optionalString(profile.displayName) ?? null,
    summary: description ? blueskyPostToHtml(description) : null,
    iconUrl: optionalString(profile.avatar) ?? null,
    headerImageUrl: optionalString(profile.banner) ?? null,
    followersCount: optionalCount(profile.followersCount),
    followingCount: optionalCount(profile.followsCount),
    postsCount: optionalCount(profile.postsCount)
  })
}

const fetchProfile = async (
  database: Database,
  agent: BlueskyAgent,
  actor: string
) =>
  storeProfile(
    database,
    actor,
    await agent.get<unknown>('app.bsky.actor.getProfile', { actor })
  )

const logFailure = (message: string, err: unknown, extra: Json) => {
  logger.warn({ message, ...extra, err: toLoggableError(err) })
}

/**
 * The stored actor id of the Bluesky account `input` names, fetched through
 * the viewer's linked account when it is not stored yet. A stored one is
 * refreshed at most every ten minutes. Null when the input is not a Bluesky
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
    const agent = await getBlueskyAgent(database, viewer)
    return agent ? await fetchProfile(database, agent, actor) : null
  } catch (error) {
    logFailure('Failed to resolve Bluesky profile', error, { actor })
    return null
  }
}

/**
 * Refreshes a stored Bluesky actor through the viewer's linked account, at
 * most once per ten minutes per actor (the row's updatedAt). Best-effort: a
 * failure keeps the stored row.
 */
export const refreshBlueskyProfile = async (
  database: Database,
  viewer: Actor,
  actorId: string
): Promise<void> => {
  if (!actorId.startsWith(PROFILE_PREFIX)) return
  const did = actorId.slice(PROFILE_PREFIX.length)
  if (!BLUESKY_DID_PATTERN.test(did)) return
  const stored = await database.getActorFromId({ id: actorId })
  if (!stored || Date.now() - stored.updatedAt < REFRESH_INTERVAL_MS) return
  try {
    const agent = await getBlueskyAgent(database, viewer)
    if (agent) await fetchProfile(database, agent, did)
  } catch (error) {
    logFailure('Failed to refresh Bluesky profile', error, { actorId })
  }
}

/**
 * Stores the newest posts of a stored Bluesky actor (app.bsky.feed.getAuthorFeed
 * through the viewer's linked account) for its profile page. Reposts and posts
 * by anyone else are skipped, and nothing is added to a Home timeline.
 */
export const loadBlueskyAuthorFeed = async (
  database: Database,
  viewer: Actor,
  actorId: string,
  { limit }: { limit: number }
): Promise<void> => {
  if (!actorId.startsWith(PROFILE_PREFIX)) return
  const did = actorId.slice(PROFILE_PREFIX.length)
  if (!BLUESKY_DID_PATTERN.test(did)) return
  const agent = await getBlueskyAgent(database, viewer)
  if (!agent) return
  const response = await agent.get<{ feed?: unknown }>(
    'app.bsky.feed.getAuthorFeed',
    { actor: did, limit: Math.min(Math.max(limit, 1), MAX_FEED_LIMIT) }
  )
  const feed = Array.isArray(response?.feed) ? response.feed : []
  const now = Date.now()
  for (const item of feed) {
    if (!isRecord(item) || item.reason || !isRecord(item.post)) continue
    const { uri, cid, author, record, embed, indexedAt } = item.post
    if (
      typeof uri !== 'string' ||
      typeof cid !== 'string' ||
      !isRecord(author) ||
      author.did !== did ||
      !isRecord(record)
    ) {
      continue
    }
    const at = parseAtUri(uri)
    if (!at || at.did !== did || at.collection !== POST_COLLECTION) continue
    const parent =
      isRecord(record.reply) && isRecord(record.reply.parent)
        ? parseAtUri(optionalString(record.reply.parent.uri) ?? '')
        : null
    const createdAt =
      Date.parse(optionalString(record.createdAt) ?? '') ||
      Date.parse(optionalString(indexedAt) ?? '') ||
      now
    await database.upsertBlueskyPost({
      uri,
      cid,
      did,
      rkey: at.rkey,
      actorId,
      text: blueskyPostToHtml(optionalString(record.text) ?? '', record.facets),
      // A clock ahead of ours must not pin the post to the top of the profile.
      createdAt: Math.min(createdAt, now),
      replyToStatusId: parent ? blueskyPostId(parent.did, parent.rkey) : null,
      attachments: blueskyImagesFromEmbed(embed)
    })
  }
}
