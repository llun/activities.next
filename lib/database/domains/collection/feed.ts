import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import type {
  AddStatusToCollectionTimelinesParams,
  GetCollectionTimelineParams,
  GetPublicCollectionTimelineParams
} from '@/lib/database/domains/collection/types'
import type { Db } from '@/lib/database/kysely'
import {
  getWhereInBatchSize,
  insertInChunks
} from '@/lib/database/kysely/inList'
import { withoutBlockedOrMutedAuthors } from '@/lib/database/kysely/visibility/blockMute'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { publiclyReadableStatus } from '@/lib/database/kysely/visibility/publiclyReadable'
import { getCompatibleTime } from '@/lib/database/sql/utils/getCompatibleTime'
import { chunkArray } from '@/lib/database/sql/utils/knex'
import {
  COLLECTION_FEED_MAX_ROWS,
  COLLECTION_FEED_TRIM_SLACK
} from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'

/**
 * Where this domain gets hydrated statuses from: the status facade's
 * getStatusesByIds, injected by lib/database/sql/index.ts. It runs on the root
 * Kysely instance, so it is only called after this domain's queries, never
 * inside a transaction.
 */
export type CollectionStatusSource = (
  statusIds: string[],
  currentActorId?: string
) => Promise<Status[]>

/**
 * The owner-scoped collection's internal `seq` (the key the feed and member
 * tables reference), or null when the collection does not exist or is not
 * owned by the actor, so every caller is owner-scoped.
 */
export const getOwnedCollectionSeq = async (
  db: Db,
  id: string,
  ownerActorId: string
): Promise<number | null> => {
  const row = await db
    .selectFrom('collections')
    .select('seq')
    .where('id', '=', id)
    .where('ownerActorId', '=', ownerActorId)
    .limit(1)
    .executeTakeFirst()
  return row ? row.seq : null
}

/**
 * Trims a collection's materialized feed back down to COLLECTION_FEED_MAX_ROWS,
 * keeping the newest rows by (sortKey, id). Runs only once the feed overshoots
 * the cap by COLLECTION_FEED_TRIM_SLACK, so eviction is batched rather than
 * paid on every insert.
 */
const trimCollectionFeed = async (
  db: Db,
  collectionSeq: number
): Promise<void> => {
  const countRow = await db
    .selectFrom('collection_timeline')
    .select((eb) => eb.fn.countAll().as('count'))
    .where('collectionSeq', '=', collectionSeq)
    .executeTakeFirst()
  const total = Number(countRow?.count ?? 0)
  if (total <= COLLECTION_FEED_MAX_ROWS + COLLECTION_FEED_TRIM_SLACK) return

  // The (sortKey, id) of the COLLECTION_FEED_MAX_ROWS-th newest row is the
  // retention boundary: everything strictly older than it is evicted.
  const boundary = await db
    .selectFrom('collection_timeline')
    .select(['sortKey', 'id'])
    .where('collectionSeq', '=', collectionSeq)
    .orderBy('sortKey', 'desc')
    .orderBy('id', 'desc')
    .offset(COLLECTION_FEED_MAX_ROWS - 1)
    .limit(1)
    .executeTakeFirst()
  if (!boundary) return

  await db
    .deleteFrom('collection_timeline')
    .where('collectionSeq', '=', collectionSeq)
    .where((eb) =>
      eb.or([
        eb('sortKey', '<', boundary.sortKey),
        eb.and([
          eb('sortKey', '=', boundary.sortKey),
          eb('id', '<', boundary.id)
        ])
      ])
    )
    .execute()
}

/**
 * Materializes the given members' most recent posts into a collection's feed
 * when they are added, so the feed shows history at once rather than only
 * posts published afterwards. `memberSeqByActorId` maps each member's actor id
 * to its collection_members.seq, the compact reference the feed stores.
 * Inserts are idempotent on the unique (collectionSeq, statusId).
 */
export const backfillCollectionFeedForMembers = async (
  db: Db,
  {
    collectionSeq,
    memberSeqByActorId
  }: {
    collectionSeq: number
    memberSeqByActorId: Map<string, number>
  }
): Promise<void> => {
  const targetActorIds = [...memberSeqByActorId.keys()]
  if (targetActorIds.length === 0) return

  for (const idChunk of chunkArray(
    targetActorIds,
    getWhereInBatchSize(db, 0)
  )) {
    // Only the newest COLLECTION_FEED_MAX_ROWS statuses across the chunk can
    // survive the trim below, so cap the read instead of pulling the history.
    const statuses = await db
      .selectFrom('statuses')
      .select(['id', 'actorId', 'createdAt'])
      .where('actorId', 'in', idChunk)
      .orderBy('createdAt', 'desc')
      .limit(COLLECTION_FEED_MAX_ROWS)
      .execute()
    if (statuses.length === 0) continue
    const rows = statuses.flatMap((statusRow) => {
      const memberSeq =
        statusRow.actorId === null
          ? undefined
          : memberSeqByActorId.get(statusRow.actorId)
      if (memberSeq === undefined) return []
      // A post without a createdAt sorts as the oldest in the feed.
      return [
        {
          collectionSeq,
          memberSeq,
          statusId: statusRow.id,
          sortKey: statusRow.createdAt ?? 0
        }
      ]
    })
    await insertInChunks(db, rows, (chunk) =>
      db
        .insertInto('collection_timeline')
        .values(chunk)
        .onConflict((conflict) =>
          conflict.columns(['collectionSeq', 'statusId']).doNothing()
        )
        .execute()
    )
  }
  await trimCollectionFeed(db, collectionSeq)
}

type CollectionFeedCursor = { id: number | null; sortKey: number }

/**
 * Reads a resolved collection's materialized feed for one projection, newest
 * first. The caller resolves `collectionSeq`: owner-scoped for
 * getCollectionTimeline, through the public-feed check for
 * getPublicCollectionTimeline.
 */
const readCollectionFeed = async (
  db: Db,
  getStatusesByIds: CollectionStatusSource,
  {
    collectionSeq,
    projection,
    ownerActorId,
    viewerActorId,
    limit,
    maxStatusId,
    minStatusId
  }: {
    collectionSeq: number
    projection: 'owner' | 'public'
    ownerActorId: string
    viewerActorId?: string
    limit: number
    maxStatusId?: string | null
    minStatusId?: string | null
  }
): Promise<Status[]> => {
  let query = db
    .selectFrom('collection_timeline')
    .innerJoin('statuses', 'statuses.id', 'collection_timeline.statusId')
    .where('collection_timeline.collectionSeq', '=', collectionSeq)
    // Public projection: only approved members, and only publicly readable
    // posts. A member's followers-only post never reaches the public feed even
    // though the owner sees it in the private projection, and neither does a
    // member's public boost of a followers-only or direct note, which this
    // anonymous feed would hydrate and serve.
    .$if(projection === 'public', (qb) =>
      qb
        .innerJoin(
          'collection_members',
          'collection_members.seq',
          'collection_timeline.memberSeq'
        )
        .where('collection_members.featureState', '=', 'approved')
        .where((eb) => publiclyReadableStatus(db, eb))
    )
    // Owner projection: every member, filtered to what the owner may read and
    // without blocked or muted authors, both before LIMIT, like the list
    // timeline.
    .$if(projection !== 'public', (qb) =>
      withoutBlockedOrMutedAuthors(
        qb.where((eb) => potentiallyReadableStatus(db, eb, ownerActorId)),
        ownerActorId,
        Date.now()
      )
    )

  // Resolves the cursor from this feed's row (sortKey + row id), falling back
  // to the status's createdAt (without the row-id tie-breaker) when the row
  // was trimmed or never written, so pagination still advances. Returns false
  // when neither exists.
  const applyCursor = async (
    cursorStatusId: string,
    operator: '<' | '>'
  ): Promise<boolean> => {
    let cursor: CollectionFeedCursor | undefined = await db
      .selectFrom('collection_timeline')
      .select(['id', 'sortKey'])
      .where('collectionSeq', '=', collectionSeq)
      .where('statusId', '=', cursorStatusId)
      .limit(1)
      .executeTakeFirst()
    if (!cursor) {
      const statusRow = await db
        .selectFrom('statuses')
        .select('createdAt')
        .where('id', '=', cursorStatusId)
        .limit(1)
        .executeTakeFirst()
      if (!statusRow) return false
      // A status without a createdAt pages as if it were the oldest.
      cursor = { id: null, sortKey: statusRow.createdAt ?? 0 }
    }
    const { id: cursorId, sortKey: cursorSortKey } = cursor
    query = query.where((eb) =>
      cursorId === null
        ? eb('collection_timeline.sortKey', operator, cursorSortKey)
        : eb.or([
            eb('collection_timeline.sortKey', operator, cursorSortKey),
            eb.and([
              eb('collection_timeline.sortKey', '=', cursorSortKey),
              eb('collection_timeline.id', operator, cursorId)
            ])
          ])
    )
    return true
  }

  if (maxStatusId && !(await applyCursor(maxStatusId, '<'))) return []
  if (minStatusId && !(await applyCursor(minStatusId, '>'))) return []

  const rows = await query
    .select('statuses.id')
    .orderBy('collection_timeline.sortKey', 'desc')
    .orderBy('collection_timeline.id', 'desc')
    .limit(limit)
    .execute()
  const statusIds = rows.map((row) => row.id)
  if (statusIds.length === 0) return []
  // `projection` chose WHICH statuses this feed contains; the viewer decides
  // whose action state they carry. A public feed read by a signed-in visitor
  // still renders interactive chips and buttons, so hydrating it anonymously
  // would show that visitor their own reaction, like and bookmark as un-acted.
  return getStatusesByIds(
    statusIds,
    viewerActorId ?? (projection === 'owner' ? ownerActorId : undefined)
  )
}

export const getCollectionTimeline = async (
  db: Db,
  getStatusesByIds: CollectionStatusSource,
  {
    id,
    actorId,
    projection = 'owner',
    currentActorId,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetCollectionTimelineParams
): Promise<Status[]> => {
  const seq = await getOwnedCollectionSeq(db, id, actorId)
  if (seq === null) return []
  return readCollectionFeed(db, getStatusesByIds, {
    collectionSeq: seq,
    projection,
    ownerActorId: actorId,
    viewerActorId: currentActorId ?? actorId,
    limit,
    maxStatusId,
    minStatusId
  })
}

export const getPublicCollectionTimeline = async (
  db: Db,
  getStatusesByIds: CollectionStatusSource,
  {
    id,
    currentActorId,
    limit = PER_PAGE_LIMIT,
    maxStatusId,
    minStatusId
  }: GetPublicCollectionTimelineParams
): Promise<Status[] | null> => {
  // Resolved by id only (no owner scope) and gated on the public-feed
  // contract: the collection must exist, not be private, and have the feed
  // enabled. null in those cases, so the route can answer 404, distinct from
  // an empty but valid public feed ([]).
  const collection = await db
    .selectFrom('collections')
    .select(['seq', 'ownerActorId', 'visibility', 'publicFeed'])
    .where('id', '=', id)
    .limit(1)
    .executeTakeFirst()
  if (!collection) return null
  if (collection.visibility === 'private' || !collection.publicFeed) {
    return null
  }
  return readCollectionFeed(db, getStatusesByIds, {
    collectionSeq: collection.seq,
    projection: 'public',
    ownerActorId: collection.ownerActorId,
    viewerActorId: currentActorId,
    limit,
    maxStatusId,
    minStatusId
  })
}

/**
 * Fans a new status into the feed of every collection whose membership
 * includes its author, then trims each of those feeds back to the cap.
 */
export const addStatusToCollectionTimelines = async (
  db: Db,
  { status }: AddStatusToCollectionTimelinesParams
): Promise<void> => {
  const memberships = await db
    .selectFrom('collection_members')
    .select(['collectionSeq', 'seq'])
    .where('targetActorId', '=', status.actorId)
    .execute()
  if (memberships.length === 0) return

  const rows = memberships.map((membership) => ({
    collectionSeq: membership.collectionSeq,
    memberSeq: membership.seq,
    statusId: status.id,
    sortKey: getCompatibleTime(status.createdAt)
  }))
  await insertInChunks(db, rows, (chunk) =>
    db
      .insertInto('collection_timeline')
      .values(chunk)
      .onConflict((conflict) =>
        conflict.columns(['collectionSeq', 'statusId']).doNothing()
      )
      .execute()
  )

  // Trim each collection the author posted into back down to the cap.
  const collectionSeqs = [
    ...new Set(memberships.map((membership) => membership.collectionSeq))
  ]
  for (const collectionSeq of collectionSeqs) {
    await trimCollectionFeed(db, collectionSeq)
  }
}
