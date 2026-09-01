import { recordActorIfNeeded } from '@/lib/actions/utils'
import {
  getActorCollections,
  isCollectionPageUrl
} from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { Actor } from '@/lib/types/domain/actor'
import type { Account as MastodonAccount } from '@/lib/types/mastodon/account'
import { normalizeActivityPubUri } from '@/lib/utils/activitypub'
import { logger } from '@/lib/utils/logger'
import { toLoggableError } from '@/lib/utils/toLoggableError'

// The Mastodon `accounts/:id/followers` and `/following` lists for a REMOTE
// actor. The `follows` table only knows relationships this instance took part
// in, so for a remote actor those routes could only ever list the local actors
// on either side of one — a client opening a remote account's Followers sheet
// saw one local follower and an empty Following. Mastodon itself behaves that
// way; this is an enhancement over it, and it reads the list the remote server
// already publishes on the actor's `followers`/`following` collections.
//
// Two costs are bounded here rather than in the routes. A collection page is
// actor URIs, and turning one into Mastodon Account entities needs stored
// rows: the known ones come back in one batch query, and each UNKNOWN one is a
// `recordActorIfNeeded` — a signed Person fetch plus three collection-root
// fetches for its counters, then an insert. So a page resolves at most
// `MAX_UNKNOWN_ACTORS_PER_PAGE` unknown actors, `UNKNOWN_ACTOR_CONCURRENCY` at
// a time, and drops the rest of that page's unknowns rather than stalling the
// request on them. And a resolved page is held for `REMOTE_FOLLOW_PAGE_TTL_MS`
// as a PROMISE, so a client re-opening the sheet, or two clients opening it at
// once, share one round of fetches — the same shape as
// `getCachedActorPublicStatusesCount` (`lib/services/statuses/`), down to
// deleting the entry on rejection so a failure is retried rather than served
// for a minute. The actor's own Person document is fetched INSIDE the cached
// work, because the collection URL lives on it: fetched outside, a cache hit
// would still cost one signed remote request per page open.

export type RemoteFollowField = 'followers' | 'following'

export const REMOTE_FOLLOW_PAGE_TTL_MS = 60_000
export const MAX_UNKNOWN_ACTORS_PER_PAGE = 20
export const UNKNOWN_ACTOR_CONCURRENCY = 5
// Bounded because entries expire but nothing sweeps them, and which actors and
// pages get asked for is chosen by clients.
export const MAX_CACHED_PAGES = 256

export interface RemoteFollowCollectionPage {
  // In the order the remote page listed them, minus the ones that could not be
  // resolved to a stored actor.
  accounts: MastodonAccount[]
  nextPageUrl: string | null
  prevPageUrl: string | null
  totalItems: number
}

export type RemoteFollowCollectionResult =
  | { status: 'ok'; page: RemoteFollowCollectionPage }
  // The remote publishes no page (a hidden collection, an unreachable actor or
  // collection): the caller should serve what this instance knows locally.
  | { status: 'unavailable' }
  // `pageUrl` is not a page of this actor's collection — a client error, not
  // something to fall back from.
  | { status: 'invalid-page' }

interface Params {
  database: Database
  actorId: string
  field: RemoteFollowField
  signingActor?: Actor
  // A page of the collection to read instead of its first page.
  pageUrl?: string
}

type CacheEntry = {
  result: Promise<RemoteFollowCollectionResult>
  expiresAt: number
}

let cacheByDatabase = new WeakMap<Database, Map<string, CacheEntry>>()

const getCacheEntries = (database: Database) => {
  const entries = cacheByDatabase.get(database)
  if (entries) return entries

  const created = new Map<string, CacheEntry>()
  cacheByDatabase.set(database, created)
  return created
}

// Insertion-order eviction, the same shape as the outbox count cache.
const setBoundedEntry = (
  entries: Map<string, CacheEntry>,
  key: string,
  entry: CacheEntry
) => {
  if (entries.has(key)) {
    entries.delete(key)
  } else if (entries.size >= MAX_CACHED_PAGES) {
    const oldestKey = entries.keys().next().value
    if (oldestKey !== undefined) entries.delete(oldestKey)
  }
  entries.set(key, entry)
}

// A collection page item is an actor id, either bare or as an object carrying
// one. Anything else — a blank node, an object with no id — is skipped rather
// than fetched.
const getItemActorId = (item: unknown): string | null => {
  if (typeof item === 'string') return normalizeActivityPubUri(item)
  if (item && typeof item === 'object' && 'id' in item) {
    const id = (item as { id?: unknown }).id
    return typeof id === 'string' ? normalizeActivityPubUri(id) : null
  }
  return null
}

const getPageUrl = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

// Runs `task` over `items` with at most `concurrency` in flight. Failures are
// the task's own to handle; this never rejects on one.
const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  task: (item: T) => Promise<void>
) => {
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await task(item)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
}

// The stored actor ids a batch of Mastodon accounts answers for. `uri` is the
// actor id the row was looked up by; `url` is the profile URL, which for a
// local actor is the same string and for a remote one usually is not. Keying
// on both is what the search route does for the same lookup.
const indexAccountsByActorId = (accounts: MastodonAccount[]) => {
  const byActorId = new Map<string, MastodonAccount>()
  for (const account of accounts) {
    for (const key of [account.uri, account.url]) {
      const actorId = normalizeActivityPubUri(key)
      if (actorId && !byActorId.has(actorId)) byActorId.set(actorId, account)
    }
  }
  return byActorId
}

const resolvePageAccounts = async ({
  database,
  actorIds,
  signingActor
}: {
  database: Database
  actorIds: string[]
  signingActor?: Actor
}): Promise<MastodonAccount[]> => {
  if (actorIds.length === 0) return []

  const knownAccounts = indexAccountsByActorId(
    await database.getMastodonActorsFromIds({ ids: actorIds })
  )

  const unknownActorIds = actorIds
    .filter((actorId) => !knownAccounts.has(actorId))
    .slice(0, MAX_UNKNOWN_ACTORS_PER_PAGE)

  const recordedActorIds: string[] = []
  await runWithConcurrency(
    unknownActorIds,
    UNKNOWN_ACTOR_CONCURRENCY,
    async (actorId) => {
      try {
        // Refuses a blocked domain by throwing, and answers undefined when the
        // actor cannot be fetched; both simply leave the entry out of the page.
        const actor = await recordActorIfNeeded({
          actorId,
          database,
          signingActor
        })
        if (actor) recordedActorIds.push(actor.id)
      } catch (error) {
        logger.warn({
          message: 'Failed to record remote follow collection actor',
          actorId,
          err: toLoggableError(error)
        })
      }
    }
  )

  const recordedAccounts =
    recordedActorIds.length > 0
      ? indexAccountsByActorId(
          await database.getMastodonActorsFromIds({ ids: recordedActorIds })
        )
      : new Map<string, MastodonAccount>()

  const seen = new Set<string>()
  return actorIds.flatMap((actorId) => {
    const account = knownAccounts.get(actorId) ?? recordedAccounts.get(actorId)
    if (!account || seen.has(account.uri)) return []
    seen.add(account.uri)
    return [account]
  })
}

const fetchRemoteFollowCollectionPage = async ({
  database,
  actorId,
  field,
  signingActor,
  pageUrl
}: Params): Promise<RemoteFollowCollectionResult> => {
  const person = await getActorPerson({ actorId, signingActor })
  const collectionUrl = person?.[field]
  if (!person || !collectionUrl) return { status: 'unavailable' }

  // The same check `remote-statuses` applies to its `page_url`: a cursor is
  // only ever a page of THIS actor's collection, never an arbitrary URL this
  // instance would then fetch on the client's behalf.
  if (pageUrl && !isCollectionPageUrl(pageUrl, collectionUrl)) {
    return { status: 'invalid-page' }
  }

  const collection = await getActorCollections({
    person,
    field,
    signingActor,
    pageUrl
  })
  // No collection, or a collection the remote publishes a size for but no
  // page of — Mastodon's "hide your social graph" — is the caller's cue to
  // fall back to what this instance knows locally.
  if (!collection?.page) return { status: 'unavailable' }

  const actorIds = Array.from(
    new Set(
      collection.page.orderedItems
        .map(getItemActorId)
        .filter((id): id is string => Boolean(id))
    )
  )
  const accounts = await resolvePageAccounts({
    database,
    actorIds,
    signingActor
  })

  return {
    status: 'ok',
    page: {
      accounts,
      nextPageUrl: getPageUrl(collection.page.next),
      prevPageUrl: getPageUrl(collection.page.prev),
      totalItems: collection.totalItems
    }
  }
}

/**
 * One page of a remote actor's `followers` or `following` collection as
 * Mastodon Account entities. Answers `unavailable` when the remote publishes
 * no page (a hidden collection, an unreachable actor) — the caller should then
 * serve the locally-known relationships — and `invalid-page` when `pageUrl`
 * is not a page of that actor's collection.
 *
 * Cached per (database, actor, field, page) for `REMOTE_FOLLOW_PAGE_TTL_MS`;
 * concurrent misses share one fetch and a rejection evicts the entry. Domain
 * policy is deliberately NOT part of the cached work: the caller checks
 * `canFederateWithDomain` per request, so a newly blocked domain is refused at
 * once rather than served from a warm entry.
 */
export const getRemoteFollowCollectionPage = (
  params: Params
): Promise<RemoteFollowCollectionResult> => {
  const { database, actorId, field, pageUrl } = params
  const entries = getCacheEntries(database)
  const key = `${field}|${actorId}|${pageUrl ?? ''}`
  const entry = entries.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.result

  const result = fetchRemoteFollowCollectionPage(params).catch((error) => {
    if (entries.get(key)?.result === result) entries.delete(key)
    throw error
  })
  setBoundedEntry(entries, key, {
    result,
    expiresAt: Date.now() + REMOTE_FOLLOW_PAGE_TTL_MS
  })
  return result
}

export const resetRemoteFollowCollectionCacheForTests = () => {
  if (!process.env.VITEST) {
    throw new Error('resetRemoteFollowCollectionCacheForTests is test-only')
  }
  cacheByDatabase = new WeakMap()
}
