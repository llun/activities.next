import { type Selectable, sql } from 'kysely'

import {
  getActorCounters,
  setActorCounters
} from '@/lib/database/domains/actor/counters'
import { createActor, updateActor } from '@/lib/database/domains/actor/writes'
import type {
  BlueskyCrosspost,
  BlueskyCrosspostState,
  BlueskyFollow,
  BlueskyInteraction,
  BlueskyInteractionKind,
  BlueskyRecord,
  UpsertBlueskyActorParams,
  UpsertBlueskyPostParams
} from '@/lib/database/domains/bluesky/types'
import { createAttachment } from '@/lib/database/domains/media/writes'
import { indexActorSearchDocument } from '@/lib/database/domains/search/accounts'
import type { StatusHydration } from '@/lib/database/domains/status/types'
import { createNoteWithResult } from '@/lib/database/domains/status/writes'
import { type Db, inTransaction, isInTransaction } from '@/lib/database/kysely'
import { setCounterValue } from '@/lib/database/kysely/counter'
import type {
  BlueskyCrossposts,
  BlueskyInteractions,
  BlueskyRecords
} from '@/lib/database/kysely/db'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'
import { CounterKey } from '@/lib/database/utils/counter'
import { getCompatibleJSON } from '@/lib/database/utils/getCompatibleJSON'
import { getCompatibleTime } from '@/lib/database/utils/getCompatibleTime'
import { isUniqueConstraintError } from '@/lib/database/utils/isUniqueConstraintError'
import { blueskyActorId, blueskyPostId } from '@/lib/services/bluesky/records'
import { Timeline } from '@/lib/services/timelines/types'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'
import { BLUESKY_DOMAIN, BLUESKY_PROFILE_PREFIX } from '@/lib/utils/blueskyId'

const BLUESKY_NETWORK = 'bluesky'

// Frees `handle` from any other Bluesky actor row (the handle moved to another
// DID), the way updateRemoteActorHandle displaces a stale remote row, so the
// actors_username_domain_unique index does not refuse the write.
const releaseHandle = async (trx: Db, actorId: string, handle: string) => {
  const holders = await trx
    .selectFrom('actors')
    .select('id')
    .where(sql`lower(${sql.ref('username')})`, '=', handle)
    .where('domain', '=', BLUESKY_DOMAIN)
    .where('network', '=', BLUESKY_NETWORK)
    .where('id', '!=', actorId)
    .execute()
  for (const holder of holders) {
    if (!holder.id) continue
    // The row's own DID, which no other row can hold: the username an
    // unverified handle gets.
    await trx
      .updateTable('actors')
      .set({
        username: holder.id.slice(BLUESKY_PROFILE_PREFIX.length),
        updatedAt: new Date()
      })
      .where('id', '=', holder.id)
      .execute()
    await indexActorSearchDocument(trx, { id: holder.id })
  }
}

// Whether a stored row already holds every given value (undefined keeps a
// value, so it matches anything).
const isActorUnchanged = async (
  trx: Db,
  actorId: string,
  row: {
    username: string | null
    name: string | null
    summary: string | null
    settings: unknown
  },
  params: UpsertBlueskyActorParams & { handle: string }
) => {
  const settings =
    getCompatibleJSON<{ iconUrl?: string; headerImageUrl?: string }>(
      row.settings as string
    ) ?? {}
  const same = (given: string | null | undefined, stored?: string | null) =>
    given === undefined || (given ?? '') === (stored ?? '')
  if (
    row.username !== params.handle ||
    !same(params.name, row.name) ||
    !same(params.summary, row.summary) ||
    !same(params.iconUrl, settings.iconUrl) ||
    !same(params.headerImageUrl, settings.headerImageUrl)
  ) {
    return false
  }
  const counters = await getActorCounters(trx, actorId)
  const sameCount = (given: number | null | undefined, stored: number) =>
    given == null || given === stored
  return (
    sameCount(params.followersCount, counters.followersCount) &&
    sameCount(params.followingCount, counters.followingCount) &&
    sameCount(params.postsCount, counters.statusCount)
  )
}

/**
 * Creates or refreshes a Bluesky actor row. A concurrent creator of the same
 * row (or one taking the same handle) can win between the read and the
 * insert; the write is then run again against the row it left.
 */
export const upsertBlueskyActor = async (
  db: Db,
  params: UpsertBlueskyActorParams
): Promise<string | null> => {
  try {
    return await writeBlueskyActor(db, params)
  } catch (error) {
    // Inside a caller's transaction PostgreSQL aborted it: the caller's error.
    if (!isUniqueConstraintError(error) || isInTransaction(db)) throw error
    return writeBlueskyActor(db, params)
  }
}

const writeBlueskyActor = async (
  db: Db,
  {
    did,
    handle: rawHandle,
    name,
    summary,
    iconUrl,
    headerImageUrl,
    followersCount,
    followingCount,
    postsCount
  }: UpsertBlueskyActorParams
): Promise<string | null> => {
  const actorId = blueskyActorId(did)
  const handle = rawHandle.toLowerCase()
  const written = await inTransaction(db, async (trx) => {
    const row = await forUpdate(
      trx,
      trx
        .selectFrom('actors')
        .select(['network', 'username', 'name', 'summary', 'settings'])
        .where('id', '=', actorId)
        .limit(1)
    ).executeTakeFirst()
    if (row && row.network !== BLUESKY_NETWORK) return false
    // Every post of an author passes through here: an unchanged row is not
    // rewritten, re-indexed or given a new updatedAt (which also dates the
    // last full profile refresh).
    if (
      row &&
      (await isActorUnchanged(trx, actorId, row, {
        did,
        handle,
        name,
        summary,
        iconUrl,
        headerImageUrl,
        followersCount,
        followingCount,
        postsCount
      }))
    ) {
      return true
    }
    if (row?.username !== handle) await releaseHandle(trx, actorId, handle)

    if (!row) {
      await createActor(trx, {
        actorId,
        username: handle,
        domain: BLUESKY_DOMAIN,
        name: name ?? undefined,
        summary: summary ?? undefined,
        iconUrl: iconUrl ?? undefined,
        headerImageUrl: headerImageUrl ?? undefined,
        // A Bluesky account has no ActivityPub inbox, followers collection or
        // key. Empty strings are what legacy remote rows already hold for
        // missing values, and delivery and signature checks refuse
        // https://bsky.app/profile/… ids before reading them.
        inboxUrl: '',
        sharedInboxUrl: '',
        followersUrl: '',
        // Anyone can follow a Bluesky account; without this, Mastodon clients
        // read the default (locked) and show "request to follow".
        manuallyApprovesFollowers: false,
        publicKey: '',
        createdAt: Date.now()
      })
      await trx
        .updateTable('actors')
        .set({ network: BLUESKY_NETWORK })
        .where('id', '=', actorId)
        .execute()
    } else {
      if (row.username !== handle) {
        await trx
          .updateTable('actors')
          .set({ username: handle, updatedAt: new Date() })
          .where('id', '=', actorId)
          .execute()
      }
      // updateActor re-indexes the search document, new handle included.
      await updateActor(trx, {
        actorId,
        // undefined keeps the stored value; null clears it.
        ...(name !== undefined ? { name: name ?? '' } : null),
        ...(summary !== undefined ? { summary: summary ?? '' } : null),
        iconUrl,
        headerImageUrl
      })
    }

    if (
      followersCount != null ||
      followingCount != null ||
      postsCount != null
    ) {
      await setActorCounters(trx, {
        actorId,
        followersCount,
        followingCount,
        statusCount: postsCount
      })
    }
    return true
  })
  return written ? actorId : null
}

// createNoteWithResult recovers a duplicate insert by reading the winner, but
// inside this transaction that read would run after PostgreSQL aborted it. It
// finds none here, so the unique violation reaches upsertBlueskyPost's own
// recovery, after the transaction.
const NO_DUPLICATE_RECOVERY: StatusHydration = {
  getStatus: async () => null,
  getStatusesByIds: async () => [],
  hydrateStatusRow: async () => null
}

export const upsertBlueskyPost = async (
  db: Db,
  {
    uri,
    cid,
    did,
    rkey,
    actorId,
    text,
    createdAt,
    replyToStatusId,
    attachments,
    sensitive = false
  }: UpsertBlueskyPostParams
): Promise<{ statusId: string; created: boolean }> => {
  const stored = await getBlueskyRecordByUri(db, { uri })
  if (stored) {
    const status = await db
      .selectFrom('statuses')
      .select('id')
      .where('id', '=', stored.statusId)
      .executeTakeFirst()
    if (status) return { statusId: stored.statusId, created: false }
    // The status was deleted and its record left behind: store it again.
    await db
      .deleteFrom('bluesky_records')
      .where('statusId', '=', stored.statusId)
      .execute()
  }

  const statusId = blueskyPostId(did, rkey)
  try {
    await inTransaction(db, async (trx) => {
      // The note writer keeps the counters, recipients and search index the
      // same as for any other status.
      await createNoteWithResult(trx, NO_DUPLICATE_RECOVERY, {
        id: statusId,
        url: statusId,
        actorId,
        text,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        reply: replyToStatusId ?? '',
        createdAt,
        sensitive
      })
      await trx
        .updateTable('statuses')
        .set({ network: BLUESKY_NETWORK })
        .where('id', '=', statusId)
        .execute()
      await trx
        .insertInto('bluesky_records')
        .values({ statusId, uri, cid })
        .execute()
      for (const [index, attachment] of attachments.entries()) {
        await createAttachment(trx, {
          actorId,
          statusId,
          mediaType: attachment.mediaType,
          url: attachment.url,
          thumbnailUrl: attachment.thumbnailUrl ?? null,
          width: attachment.width,
          height: attachment.height,
          name: attachment.description,
          // Attachments read back by createdAt then a random id: keep the
          // post's image order, as createNote does.
          createdAt: createdAt + index
        })
      }
    })
    return { statusId, created: true }
  } catch (error) {
    // Inside a caller's transaction the failed statement aborted it on
    // PostgreSQL, so the error is the caller's to handle.
    if (!isUniqueConstraintError(error) || isInTransaction(db)) throw error
    // A concurrent sync stored the same post first.
    const winner = await getBlueskyRecordByUri(db, { uri })
    if (!winner) throw error
    return { statusId: winner.statusId, created: false }
  }
}

const toRecord = (row: Selectable<BlueskyRecords>): BlueskyRecord => ({
  statusId: row.statusId,
  uri: row.uri,
  cid: row.cid,
  createdAt: getCompatibleTime(row.createdAt)
})

export const getBlueskyRecordByStatusId = async (
  db: Db,
  { statusId }: { statusId: string }
): Promise<BlueskyRecord | null> => {
  const row = await db
    .selectFrom('bluesky_records')
    .selectAll()
    .where('statusId', '=', statusId)
    .executeTakeFirst()
  return row ? toRecord(row) : null
}

export const getBlueskyRecordByUri = async (
  db: Db,
  { uri }: { uri: string }
): Promise<BlueskyRecord | null> => {
  const row = await db
    .selectFrom('bluesky_records')
    .selectAll()
    .where('uri', '=', uri)
    .executeTakeFirst()
  return row ? toRecord(row) : null
}

export const isBlueskyPostInHome = async (
  db: Db,
  { actorId, statusId }: { actorId: string; statusId: string }
): Promise<boolean> =>
  Boolean(
    await db
      .selectFrom('timelines')
      .select('id')
      .where('actorId', '=', actorId)
      .where('timeline', '=', Timeline.MAIN)
      .where('statusId', '=', statusId)
      .executeTakeFirst()
  )

export const removeBoostsOfStatusFromHome = async (
  db: Db,
  { actorId, statusId }: { actorId: string; statusId: string }
): Promise<void> => {
  await db
    .deleteFrom('timelines')
    .where('actorId', '=', actorId)
    .where('timeline', '=', Timeline.MAIN)
    .where('statusId', 'in', (eb) =>
      eb
        .selectFrom('statuses')
        .select('statuses.id')
        .where('statuses.type', '=', StatusType.enum.Announce)
        .where('statuses.originalStatusId', '=', statusId)
    )
    .execute()
}

export const createBlueskyFollow = async (
  db: Db,
  {
    actorId,
    targetActorId,
    uri
  }: { actorId: string; targetActorId: string; uri: string }
): Promise<void> => {
  await db
    .insertInto('bluesky_follows')
    .values({ actorId, targetActorId, uri })
    .onConflict((oc) =>
      oc.columns(['actorId', 'targetActorId']).doUpdateSet({ uri })
    )
    .execute()
}

export const deleteBlueskyFollow = async (
  db: Db,
  { actorId, targetActorId }: { actorId: string; targetActorId: string }
): Promise<void> => {
  await db
    .deleteFrom('bluesky_follows')
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .execute()
}

export const getBlueskyFollow = async (
  db: Db,
  { actorId, targetActorId }: { actorId: string; targetActorId: string }
): Promise<BlueskyFollow | null> => {
  const row = await db
    .selectFrom('bluesky_follows')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('targetActorId', '=', targetActorId)
    .executeTakeFirst()
  return row
    ? {
        actorId: row.actorId,
        targetActorId: row.targetActorId,
        uri: row.uri,
        createdAt: getCompatibleTime(row.createdAt)
      }
    : null
}

export const getBlueskyFollowTargetIds = async (
  db: Db,
  { actorId }: { actorId: string }
): Promise<string[]> => {
  const rows = await db
    .selectFrom('bluesky_follows')
    .select('targetActorId')
    .where('actorId', '=', actorId)
    .execute()
  return rows.map((row) => row.targetActorId)
}

const toInteraction = (
  row: Selectable<BlueskyInteractions>
): BlueskyInteraction => ({
  actorId: row.actorId,
  statusId: row.statusId,
  kind: row.kind as BlueskyInteractionKind,
  uri: row.uri,
  createdAt: getCompatibleTime(row.createdAt)
})

export const getBlueskyInteraction = async (
  db: Db,
  {
    actorId,
    statusId,
    kind
  }: { actorId: string; statusId: string; kind: BlueskyInteractionKind }
): Promise<BlueskyInteraction | null> => {
  const row = await db
    .selectFrom('bluesky_interactions')
    .selectAll()
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .where('kind', '=', kind)
    .executeTakeFirst()
  return row ? toInteraction(row) : null
}

export const createBlueskyInteraction = async (
  db: Db,
  {
    actorId,
    statusId,
    kind,
    uri
  }: {
    actorId: string
    statusId: string
    kind: BlueskyInteractionKind
    uri: string
  }
): Promise<void> => {
  await db
    .insertInto('bluesky_interactions')
    .values({ actorId, statusId, kind, uri })
    .onConflict((oc) => oc.columns(['actorId', 'statusId', 'kind']).doNothing())
    .execute()
}

export const deleteBlueskyInteraction = async (
  db: Db,
  {
    actorId,
    statusId,
    kind
  }: { actorId: string; statusId: string; kind: BlueskyInteractionKind }
): Promise<void> => {
  await db
    .deleteFrom('bluesky_interactions')
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .where('kind', '=', kind)
    .execute()
}

const isValidCount = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

export const setBlueskyPostCounts = async (
  db: Db,
  {
    statusId,
    likes,
    reposts,
    replies
  }: {
    statusId: string
    likes?: number | null
    reposts?: number | null
    replies?: number | null
  }
): Promise<void> => {
  const currentTime = new Date()
  const entries: [string, number | null | undefined][] = [
    [CounterKey.totalLike(statusId), likes],
    [CounterKey.totalReblog(statusId), reposts],
    [CounterKey.totalReply(statusId), replies]
  ]
  await Promise.all(
    entries
      .filter((entry): entry is [string, number] => isValidCount(entry[1]))
      .map(([key, value]) => setCounterValue(db, key, value, currentTime))
  )
}

export const updateBlueskyAccountSync = async (
  db: Db,
  {
    actorId,
    lastSyncedAt,
    syncError
  }: {
    actorId: string
    lastSyncedAt?: number | null
    syncError?: string | null
  }
): Promise<void> => {
  if (lastSyncedAt === undefined && syncError === undefined) return
  await db
    .updateTable('bluesky_accounts')
    .set({
      ...(lastSyncedAt !== undefined
        ? {
            lastSyncedAt: lastSyncedAt === null ? null : new Date(lastSyncedAt)
          }
        : null),
      ...(syncError !== undefined ? { syncError } : null)
    })
    .where('actorId', '=', actorId)
    .execute()
}

const toCrosspost = (row: Selectable<BlueskyCrossposts>): BlueskyCrosspost => ({
  statusId: row.statusId,
  actorId: row.actorId,
  uri: row.uri ?? null,
  cid: row.cid ?? null,
  state: row.state as BlueskyCrosspostState,
  error: row.error ?? null,
  createdAt: getCompatibleTime(row.createdAt),
  updatedAt: getCompatibleTime(row.updatedAt)
})

export const getBlueskyCrosspost = async (
  db: Db,
  { statusId }: { statusId: string }
): Promise<BlueskyCrosspost | null> => {
  const row = await db
    .selectFrom('bluesky_crossposts')
    .selectAll()
    .where('statusId', '=', statusId)
    .executeTakeFirst()
  return row ? toCrosspost(row) : null
}

export const getBlueskyCrosspostByUri = async (
  db: Db,
  { uri }: { uri: string }
): Promise<BlueskyCrosspost | null> => {
  const row = await db
    .selectFrom('bluesky_crossposts')
    .selectAll()
    .where('uri', '=', uri)
    .executeTakeFirst()
  return row ? toCrosspost(row) : null
}

// The cross-post rows of a page of statuses, keyed by statusId. Batched so the
// status hydration does not run one lookup per status.
export const getBlueskyCrosspostsByStatusIds = async (
  db: Db,
  { statusIds }: { statusIds: string[] }
): Promise<Map<string, BlueskyCrosspost>> => {
  const crossposts = new Map<string, BlueskyCrosspost>()
  if (statusIds.length === 0) return crossposts
  const rows = await selectInChunks(db, statusIds, (chunk) =>
    db
      .selectFrom('bluesky_crossposts')
      .selectAll()
      .where('statusId', 'in', chunk)
      .execute()
  )
  for (const row of rows) {
    crossposts.set(row.statusId, toCrosspost(row))
  }
  return crossposts
}

export const claimBlueskyCrosspost = async (
  db: Db,
  { statusId, actorId }: { statusId: string; actorId: string }
): Promise<boolean> => {
  const result = await db
    .insertInto('bluesky_crossposts')
    .values({ statusId, actorId, state: 'pending' })
    .onConflict((oc) => oc.column('statusId').doNothing())
    .executeTakeFirst()
  return Number(result.numInsertedOrUpdatedRows ?? 0) > 0
}

export const markBlueskyCrosspostPosted = async (
  db: Db,
  { statusId, uri, cid }: { statusId: string; uri: string; cid: string }
): Promise<void> => {
  await db
    .updateTable('bluesky_crossposts')
    .set({ uri, cid, state: 'posted', error: null, updatedAt: new Date() })
    .where('statusId', '=', statusId)
    .execute()
}

export const markBlueskyCrosspostFailed = async (
  db: Db,
  { statusId, error }: { statusId: string; error: string }
): Promise<void> => {
  await db
    .updateTable('bluesky_crossposts')
    .set({ state: 'failed', error, updatedAt: new Date() })
    .where('statusId', '=', statusId)
    .execute()
}

export const resetBlueskyCrosspostForRetry = async (
  db: Db,
  { statusId }: { statusId: string }
): Promise<boolean> => {
  const result = await db
    .updateTable('bluesky_crossposts')
    .set({ state: 'pending', error: null, updatedAt: new Date() })
    .where('statusId', '=', statusId)
    .where('state', '=', 'failed')
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0) > 0
}

export const deleteBlueskyCrosspost = async (
  db: Db,
  { statusId }: { statusId: string }
): Promise<void> => {
  await db
    .deleteFrom('bluesky_crossposts')
    .where('statusId', '=', statusId)
    .execute()
}

export const blueskyQueries = {
  upsertBlueskyActor,
  upsertBlueskyPost,
  getBlueskyRecordByStatusId,
  getBlueskyRecordByUri,
  isBlueskyPostInHome,
  removeBoostsOfStatusFromHome,
  createBlueskyFollow,
  deleteBlueskyFollow,
  getBlueskyFollow,
  getBlueskyFollowTargetIds,
  getBlueskyInteraction,
  createBlueskyInteraction,
  deleteBlueskyInteraction,
  setBlueskyPostCounts,
  updateBlueskyAccountSync,
  getBlueskyCrosspost,
  getBlueskyCrosspostByUri,
  getBlueskyCrosspostsByStatusIds,
  claimBlueskyCrosspost,
  markBlueskyCrosspostPosted,
  markBlueskyCrosspostFailed,
  resetBlueskyCrosspostForRetry,
  deleteBlueskyCrosspost
}
