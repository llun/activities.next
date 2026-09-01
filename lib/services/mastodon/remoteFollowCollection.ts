import {
  BlockedFederationDomainError,
  recordActorIfNeeded
} from '@/lib/actions/utils'
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
// The costs are bounded here rather than in the routes, and by three
// different mechanisms because they bound three different things.
//
// A collection page is actor URIs, and turning one into Mastodon Account
// entities needs stored rows: the known ones come back in one batch query,
// and each UNKNOWN one is a `recordActorIfNeeded` — a signed Person fetch plus
// three collection-root fetches for its counters, then an insert. So a page
// is cut to `MAX_PAGE_ITEMS` ids first, resolves at most
// `MAX_UNKNOWN_ACTORS_PER_PAGE` unknown actors among them,
// `UNKNOWN_ACTOR_CONCURRENCY` at a time, and drops the rest of that page's
// unknowns rather than stalling the request on them.
//
// A resolved page is held for `REMOTE_FOLLOW_PAGE_TTL_MS` as a PROMISE, so a
// client re-opening the sheet, or two clients opening it at once, share one
// round of fetches — the same shape as `getCachedActorPublicStatusesCount`
// (`lib/services/statuses/`), down to deleting the entry on rejection so a
// failure is retried rather than served for a minute. The actor's own Person
// document is fetched INSIDE the cached work, because the collection URL lives
// on it: fetched outside, a cache hit would still cost one signed remote
// request per page open. The cache bounds REPEAT opens and nothing else: a
// page URL is client-chosen and `isCollectionPageUrl` checks only the
// origin and path, so a caller can mint a fresh key per request by varying
// the query string (the key is normalized, which closes reordering and
// fragments, not a nonce).
//
// Adversarial use is bounded by `MAX_IN_FLIGHT_REMOTE_READS` instead: a read
// that would exceed it answers `unavailable` at once, uncached, and the route
// serves the local rows — today's behaviour — so a flood degrades this
// instance to what it did before rather than fanning out to remote servers.
// A genuine viewer under that load gets the local list for one request, which
// is the trade the fallback exists for.

export type RemoteFollowField = 'followers' | 'following'

export const REMOTE_FOLLOW_PAGE_TTL_MS = 60_000
// The route's own maximum page size; a remote page is never served past it.
export const MAX_PAGE_ITEMS = 80
export const MAX_UNKNOWN_ACTORS_PER_PAGE = 20
export const UNKNOWN_ACTOR_CONCURRENCY = 5
// Uncached page reads in flight at once, per database instance (one per process
// today). Sized for a handful of people opening sheets at the same moment, not
// for a page per request. Note: a single read holds its slot through up to 20
// unknown-actor fetches, so slow remote domains can occupy slots under retries;
// capped low so memory and socket pressure remain bounded.
export const MAX_IN_FLIGHT_REMOTE_READS = 4
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
  // collection, a page in a shape this reader does not handle), or this
  // process is already at its in-flight limit: the caller should serve what
  // this instance knows locally.
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

type CacheState = {
  entries: Map<string, CacheEntry>
  inFlightReads: number
}

let cacheByDatabase = new WeakMap<Database, CacheState>()

const getCacheState = (database: Database) => {
  const state = cacheByDatabase.get(database)
  if (state) return state

  const created: CacheState = { entries: new Map(), inFlightReads: 0 }
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

// The same page spelled with its query in another order, or with a fragment,
// is the same page. A parse failure keeps the raw value; the fetch decides
// what it is.
const normalizePageUrlKey = (pageUrl: string | undefined) => {
  if (!pageUrl) return ''
  try {
    const url = new URL(pageUrl)
    url.hash = ''
    url.searchParams.sort()
    return url.toString()
  } catch {
    return pageUrl
  }
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

const getPageUrl = (value: unknown, collectionUrl: string): string | null =>
  typeof value === 'string' &&
  value.length > 0 &&
  isCollectionPageUrl(value, collectionUrl)
    ? value
    : null

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

// `uri` is the stored actor id the row was looked up by — the serializer
// writes `sqlActor.id` there — so it is the key a page's actor ids resolve
// against.
const indexAccountsByActorId = (accounts: MastodonAccount[]) => {
  const byActorId = new Map<string, MastodonAccount>()
  for (const account of accounts) {
    const actorId = normalizeActivityPubUri(account.uri)
    if (actorId && !byActorId.has(actorId)) byActorId.set(actorId, account)
  }
  return byActorId
}

const recordUnknownActor = async ({
  database,
  actorId,
  signingActor
}: {
  database: Database
  actorId: string
  signingActor?: Actor
}): Promise<string | null> => {
  try {
    // Refuses a blocked domain by throwing, and answers undefined when the
    // actor cannot be fetched; both simply leave the entry out of the page.
    const actor = await recordActorIfNeeded({ actorId, database, signingActor })
    return actor?.id ?? null
  } catch (error) {
    if (error instanceof BlockedFederationDomainError) {
      // Policy working as configured, not a failure.
      logger.debug({
        message: 'Skipped blocked-domain actor in remote follow collection',
        actorId
      })
      return null
    }
    // The same unknown actor can be recorded at the same moment from the
    // other collection's entry (or any other path that records actors); the
    // loser's insert fails on the id's unique constraint after the row exists.
    // Re-read before giving the actor up for the whole TTL.
    const existing = await database
      .getActorFromId({ id: actorId })
      .catch(() => null)
    if (existing) {
      logger.debug({
        message:
          'Actor record threw but row exists (likely insert race or background refresh error)',
        actorId,
        err: toLoggableError(error)
      })
      return existing.id
    }

    logger.warn({
      message: 'Failed to record remote follow collection actor',
      actorId,
      err: toLoggableError(error)
    })
    return null
  }
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
      const recordedId = await recordUnknownActor({
        database,
        actorId,
        signingActor
      })
      if (recordedId) recordedActorIds.push(recordedId)
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
  // fall back to what this instance knows locally. So is a page whose items
  // are not the `orderedItems` array this reader handles (`items`, or a
  // non-array): the body is parsed JSON with no schema, and a shape this
  // cannot read must be a cached `unavailable`, never a thrown TypeError that
  // evicts the entry and is retried on every open.
  const orderedItems = collection?.page?.orderedItems
  if (!collection?.page || !Array.isArray(orderedItems)) {
    return { status: 'unavailable' }
  }

  const actorIds = Array.from(
    new Set(
      orderedItems.map(getItemActorId).filter((id): id is string => Boolean(id))
    )
  ).slice(0, MAX_PAGE_ITEMS)
  const accounts = await resolvePageAccounts({
    database,
    actorIds,
    signingActor
  })

  return {
    status: 'ok',
    page: {
      accounts,
      nextPageUrl: getPageUrl(collection.page.next, collectionUrl),
      prevPageUrl: getPageUrl(collection.page.prev, collectionUrl),
      totalItems: collection.totalItems
    }
  }
}

/**
 * One page of a remote actor's `followers` or `following` collection as
 * Mastodon Account entities. Answers `unavailable` when the remote publishes
 * no page (a hidden collection, an unreachable actor), when the page is in a
 * shape this reader does not handle, or when this process already has
 * `MAX_IN_FLIGHT_REMOTE_READS` uncached reads running — the caller should
 * then serve the locally-known relationships — and `invalid-page` when
 * `pageUrl` is not a page of that actor's collection.
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
  const state = getCacheState(database)
  const key = `${field}|${actorId}|${normalizePageUrlKey(pageUrl)}`
  const entry = state.entries.get(key)
  if (entry && entry.expiresAt > Date.now()) return entry.result

  if (state.inFlightReads >= MAX_IN_FLIGHT_REMOTE_READS) {
    return Promise.resolve({ status: 'unavailable' })
  }

  state.inFlightReads += 1
  const result = fetchRemoteFollowCollectionPage(params)
    .catch((error) => {
      if (state.entries.get(key)?.result === result) state.entries.delete(key)
      throw error
    })
    .finally(() => {
      state.inFlightReads -= 1
    })
  setBoundedEntry(state.entries, key, {
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
