import { sql } from 'kysely'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import {
  getLocalActorIds,
  localPublicStatusesQuery
} from '@/lib/database/domains/timeline/localPublic'
import type {
  AddStatusToFederatedTimelineParams,
  CreateTimelineStatusParams,
  GetTimelineParams
} from '@/lib/database/domains/timeline/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import {
  type StoredKeysetCursor,
  pastStoredKeyset
} from '@/lib/database/kysely/keyset'
import { notFromExclusiveListMember } from '@/lib/database/kysely/visibility/exclusiveLists'
import { Timeline } from '@/lib/services/timelines/types'
import type { Status } from '@/lib/types/domain/status'

/**
 * Where this domain gets hydrated statuses from: the status facade's
 * getStatusesByIds, injected by lib/database/getSQLDatabase.ts. It runs on the root
 * Kysely instance, so it is only called after this domain's queries, never
 * inside a transaction.
 */
export type TimelineStatusSource = (
  statusIds: string[],
  currentActorId?: string
) => Promise<Status[]>

// A cursor whose row has a NULL createdAt. Both arms of the keyset compare
// against it with an operator (`createdAt < NULL`, `createdAt = NULL`), which
// is never true, so such a cursor reads an empty page; pastStoredKeyset's NULL
// arm (the two-argument `createdAt IS NULL` tie) is a different comparison, so
// these feeds stop before it.
const hasNullCreatedAt = (...cursors: (StoredKeysetCursor | null)[]) =>
  cursors.some((cursor) => cursor !== null && cursor.createdAt === null)

// The (id, createdAt) of a status, the cursor of the public feeds.
const lookupStatusCursor = async (
  db: Db,
  statusId: string
): Promise<StoredKeysetCursor | null> => {
  const row = await db
    .selectFrom('statuses')
    .select(['id', 'createdAt'])
    .where('id', '=', statusId)
    .limit(1)
    .executeTakeFirst()
  return row ? { createdAt: row.createdAt, tieBreaker: row.id } : null
}

const getLocalPublicTimeline = async (
  db: Db,
  getStatusesByIds: TimelineStatusSource,
  {
    minStatusId,
    maxStatusId,
    limit,
    onlyMedia
  }: {
    minStatusId?: string | null
    maxStatusId?: string | null
    limit: number
    onlyMedia: boolean
  }
): Promise<Status[]> => {
  const [maxRow, minRow, localActorIds] = await Promise.all([
    maxStatusId ? lookupStatusCursor(db, maxStatusId) : null,
    minStatusId ? lookupStatusCursor(db, minStatusId) : null,
    getLocalActorIds(db)
  ])

  if (maxStatusId && !maxRow) return []
  if (minStatusId && !minRow) return []
  // A server with no local actors has no local public timeline. Returning
  // early keeps that case from reaching the database at all, and an empty IN
  // list is a syntax error on PostgreSQL.
  if (localActorIds.length === 0) return []

  if (hasNullCreatedAt(maxRow, minRow)) return []

  let query = localPublicStatusesQuery(db, localActorIds)
    .select('statuses.id as statusId')
    .$if(onlyMedia, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('attachments')
            .select(sql.lit(1).as('one'))
            .whereRef('attachments.statusId', '=', 'statuses.id')
        )
      )
    )
  if (maxRow) {
    query = query.where((eb) =>
      pastStoredKeyset(eb, maxRow, '<', 'statuses.id', 'statuses.createdAt')
    )
  }
  if (minRow) {
    query = query.where((eb) =>
      pastStoredKeyset(eb, minRow, '>', 'statuses.id', 'statuses.createdAt')
    )
  }

  const rows = await query
    .orderBy('statuses.createdAt', 'desc')
    .orderBy('statuses.id', 'desc')
    .limit(limit)
    .execute()
  return getStatusesByIds(rows.map((row) => row.statusId))
}

const getFederatedPublicTimeline = async (
  db: Db,
  getStatusesByIds: TimelineStatusSource,
  {
    minStatusId,
    maxStatusId,
    limit,
    onlyMedia
  }: {
    minStatusId?: string | null
    maxStatusId?: string | null
    limit: number
    onlyMedia: boolean
  }
): Promise<Status[]> => {
  // Remote public statuses ingested from accepted relays, materialized in
  // `federated_timeline`, joined back to `statuses` and paged with the same
  // (createdAt, id) keyset as LOCAL_PUBLIC.
  const [maxRow, minRow] = await Promise.all([
    maxStatusId ? lookupStatusCursor(db, maxStatusId) : null,
    minStatusId ? lookupStatusCursor(db, minStatusId) : null
  ])

  if (maxStatusId && !maxRow) return []
  if (minStatusId && !minRow) return []

  if (hasNullCreatedAt(maxRow, minRow)) return []

  let query = db
    .selectFrom('federated_timeline')
    .innerJoin('statuses', 'federated_timeline.statusId', 'statuses.id')
    .select('statuses.id as statusId')
    // Top-level posts only, matching LOCAL_PUBLIC and Mastodon's public
    // timeline semantics (replies are excluded).
    .where('statuses.reply', '=', '')
    .$if(onlyMedia, (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('attachments')
            .select(sql.lit(1).as('one'))
            .whereRef('attachments.statusId', '=', 'statuses.id')
        )
      )
    )
  if (maxRow) {
    query = query.where((eb) =>
      pastStoredKeyset(eb, maxRow, '<', 'statuses.id', 'statuses.createdAt')
    )
  }
  if (minRow) {
    query = query.where((eb) =>
      pastStoredKeyset(eb, minRow, '>', 'statuses.id', 'statuses.createdAt')
    )
  }

  const rows = await query
    .orderBy('statuses.createdAt', 'desc')
    .orderBy('statuses.id', 'desc')
    .limit(limit)
    .execute()
  return getStatusesByIds(rows.map((row) => row.statusId))
}

const getActorTimeline = async (
  db: Db,
  getStatusesByIds: TimelineStatusSource,
  {
    timeline,
    actorId,
    minStatusId,
    sinceStatusId,
    maxStatusId,
    limit
  }: {
    timeline: Timeline.MAIN | Timeline.HOME | Timeline.DIRECT
    actorId: string
    minStatusId?: string | null
    sinceStatusId?: string | null
    maxStatusId?: string | null
    limit: number
  }
): Promise<Status[]> => {
  const actualTimeline = timeline === Timeline.HOME ? Timeline.MAIN : timeline

  const lookupTimelineCursor = async (
    statusId: string
  ): Promise<StoredKeysetCursor | null> => {
    const timelineRow = await db
      .selectFrom('timelines')
      .select(['id', 'createdAt'])
      .where('actorId', '=', actorId)
      .where('timeline', '=', actualTimeline)
      .where('statusId', '=', statusId)
      .limit(1)
      .executeTakeFirst()
    if (timelineRow) {
      return { createdAt: timelineRow.createdAt, tieBreaker: timelineRow.id }
    }

    // Fallback: the status may have left the timeline (e.g. after a
    // deletion) while its creation time is still known. Use it as the cursor
    // without the row-id tie-breaker so pagination can continue.
    const statusRow = await db
      .selectFrom('statuses')
      .select('createdAt')
      .where('id', '=', statusId)
      .limit(1)
      .executeTakeFirst()
    return statusRow
      ? { createdAt: statusRow.createdAt, tieBreaker: null }
      : null
  }

  // min_id and since_id are both lower-bound cursors (rows newer than it);
  // they differ only in ordering, handled below. min_id ascends from the
  // cursor (the oldest rows just newer than it) then reverses to newest-first,
  // returning the page adjacent to the cursor; since_id / max_id / no cursor
  // keep DESC (the newest slice above the cursor).
  const ascending = Boolean(minStatusId)
  const lowerBoundStatusId = minStatusId || sinceStatusId
  const [maxRow, minRow] = await Promise.all([
    maxStatusId ? lookupTimelineCursor(maxStatusId) : null,
    lowerBoundStatusId ? lookupTimelineCursor(lowerBoundStatusId) : null
  ])

  if (maxStatusId && !maxRow) return []
  if (lowerBoundStatusId && !minRow) return []

  if (hasNullCreatedAt(maxRow, minRow)) return []

  let query = db
    .selectFrom('timelines')
    .select('statusId')
    .where('actorId', '=', actorId)
    .where('timeline', '=', actualTimeline)
    // Exclusive lists hide their members from the home feed only — the home
    // tab (MAIN/HOME) — never from the direct feed, where such posts must
    // still surface.
    .$if(timeline === Timeline.MAIN || timeline === Timeline.HOME, (qb) =>
      qb.where((eb) => notFromExclusiveListMember(eb, actorId))
    )
  if (maxRow) {
    query = query.where((eb) => pastStoredKeyset(eb, maxRow, '<', 'id'))
  }
  if (minRow) {
    query = query.where((eb) => pastStoredKeyset(eb, minRow, '>', 'id'))
  }

  // min_id scans ascending (oldest rows just newer than the cursor) so the
  // keyset seek and limit land on the page adjacent to the cursor; the id
  // list is reversed below to the newest-first response shape. Every other
  // cursor kind (since_id / max_id / none) stays newest-first DESC. The
  // filtered home/direct feed (getFilteredStatusPage) mirrors this: it
  // backfills DESC for since/max and ascends for min_id.
  const order = ascending ? 'asc' : 'desc'
  const rows = await query
    .orderBy('createdAt', order)
    .orderBy('id', order)
    .limit(limit)
    .execute()
  // Ascending (min_id) rows come back oldest-first; flip to newest-first.
  if (ascending) rows.reverse()

  // One batched hydration rather than a status-at-a-time loop: this is the
  // busiest page in the app, and the per-status path re-queries detected
  // languages, quote edges, bookmarks, likes and reaction rollups once per
  // row. getStatusesByIds returns them in the ids' order, so the timeline
  // ordering established above is preserved.
  return getStatusesByIds(
    rows.map(({ statusId }) => statusId as string),
    actorId
  )
}

export const getTimeline = async (
  db: Db,
  getStatusesByIds: TimelineStatusSource,
  {
    timeline,
    actorId,
    minStatusId,
    sinceStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT,
    onlyMedia = false
  }: GetTimelineParams
): Promise<Status[]> => {
  switch (timeline) {
    case Timeline.LOCAL_PUBLIC:
      return getLocalPublicTimeline(db, getStatusesByIds, {
        minStatusId,
        maxStatusId,
        limit,
        onlyMedia
      })
    case Timeline.FEDERATED_PUBLIC:
      return getFederatedPublicTimeline(db, getStatusesByIds, {
        minStatusId,
        maxStatusId,
        limit,
        onlyMedia
      })
    case Timeline.MAIN:
    case Timeline.HOME:
    case Timeline.DIRECT:
      if (!actorId) return []
      return getActorTimeline(db, getStatusesByIds, {
        timeline,
        actorId,
        minStatusId,
        sinceStatusId,
        maxStatusId,
        limit
      })
    default:
      return []
  }
}

/**
 * How many statuses the local public timeline holds (the set
 * `getTimeline({ timeline: LOCAL_PUBLIC })` pages over), or with `limit`, how
 * many up to that many.
 */
export const getLocalPublicStatusesCount = async (
  db: Db,
  limit?: number
): Promise<number> => {
  // Shares localPublicStatusesQuery with the LOCAL_PUBLIC feed, so the
  // threshold can never disagree with the feed it gates.
  const localActorIds = await getLocalActorIds(db)
  if (localActorIds.length === 0) return 0

  const query = localPublicStatusesQuery(db, localActorIds)

  // The landing only needs to know whether the count reaches a threshold, not
  // the exact total. When `limit` is given, fetch at most `limit` ids and
  // return how many came back, so the scan stops early instead of counting
  // every public post on every unauthenticated request (a DoS risk at scale).
  // The semi-join is what makes that bound real — see the note on
  // localPublicStatusesQuery for why the DISTINCT form it replaced could not
  // stop early despite carrying the same LIMIT.
  if (limit !== undefined) {
    const rows = await query.select('statuses.id').limit(limit).execute()
    return rows.length
  }

  // No DISTINCT needed: the recipients semi-join yields each status once, and
  // the local-actor test is a filter on `statuses` rather than a join that
  // could multiply rows.
  const row = await query
    .select((eb) => eb.fn.count('statuses.id').as('count'))
    .executeTakeFirst()
  return row ? Number(row.count) : 0
}

/**
 * Adds a status to one actor's materialized timeline once: a status already
 * there is left as it is. A missing actorId throws before any query runs:
 * without that, the existence check below compares `actorId = NULL`, which
 * never matches, so it would insert a `timelines` row with a NULL actorId on
 * every call (the unique key treats NULLs as distinct).
 */
export const createTimelineStatus = async (
  db: Db,
  { actorId, status, timeline }: CreateTimelineStatusParams
): Promise<void> => {
  if (actorId === undefined || actorId === null) {
    throw new Error('createTimelineStatus requires an actorId')
  }

  await inTransaction(db, async (trx) => {
    const exists = await trx
      .selectFrom('timelines')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('actorId', '=', actorId)
      .where('statusId', '=', status.id)
      .where('timeline', '=', timeline)
      .executeTakeFirst()
    if (exists && Number(exists.count)) return

    await trx
      .insertInto('timelines')
      .values({
        actorId,
        statusId: status.id,
        statusActorId: status.actorId,
        timeline,
        createdAt: new Date(status.createdAt),
        updatedAt: new Date()
      })
      .execute()
  })
}

/**
 * Appends a relay-ingested status to the federated timeline. A relay can
 * forward the same public status more than once (e.g. through several
 * relays), so a duplicate is ignored.
 */
export const addStatusToFederatedTimeline = async (
  db: Db,
  { statusId, statusActorId }: AddStatusToFederatedTimelineParams
): Promise<void> => {
  await db
    .insertInto('federated_timeline')
    .values({ statusId, statusActorId, createdAt: new Date() })
    .onConflict((conflict) => conflict.column('statusId').doNothing())
    .execute()
}

/**
 * The timeline facade methods as `(db, params)` queries. getTimeline hydrates
 * its statuses through `getStatusesByIds` (the status facade's, injected),
 * after this domain's queries and outside any transaction.
 */
export const createTimelineQueries = (
  getStatusesByIds: TimelineStatusSource
) => ({
  getTimeline: (db: Db, params: GetTimelineParams) =>
    getTimeline(db, getStatusesByIds, params),
  getLocalPublicStatusesCount,
  createTimelineStatus,
  addStatusToFederatedTimeline
})
