import { type ExpressionBuilder, sql } from 'kysely'

import { PER_PAGE_LIMIT } from '@/lib/database/constants'
import { getHashtagStorageNames } from '@/lib/database/domains/search/rows'
import {
  buildStatusHydrationContext,
  hydrateStatusRow
} from '@/lib/database/domains/status/hydration'
import type {
  GetActorStatusesCountParams,
  GetActorStatusesParams,
  GetStatusCountsParams,
  GetStatusReblogsCountParams,
  GetStatusRepliesCountParams,
  GetStatusRepliesParams,
  GetStatusesByIdsParams,
  StatusRow
} from '@/lib/database/domains/status/types'
import type { DB, Db } from '@/lib/database/kysely'
import {
  getCounterValue,
  getCounterValues
} from '@/lib/database/kysely/counter'
import type { EpochMs } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { chunkArray, getWhereInBatchSize } from '@/lib/database/kysely/inList'
import { actorVisibleStatusIds } from '@/lib/database/kysely/visibility/actorVisible'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import {
  publiclyReadableStatus,
  publiclyReadableStatusIds
} from '@/lib/database/kysely/visibility/publiclyReadable'
import { CounterKey } from '@/lib/database/utils/counter'
import { type Status, StatusType } from '@/lib/types/domain/status'

// The status reads: the reply and actor feeds, statuses by id, and the status,
// reblog and reply counts. Each feed reads its rows here and hydrates them
// (./hydration.ts) with one batched context for the page.

// The page size read through parseInt, with no LIMIT at all for a value that
// does not parse.
const lenientLimit = <QB extends { limit(limit: number): QB }>(
  query: QB,
  limit: unknown
): QB => {
  const value = parseInt(limit as string, 10)
  return Number.isNaN(value) ? query : query.limit(value)
}

// `statuses.reply` names the parent by id, or by url when one is given.
const repliesTo = (
  eb: ExpressionBuilder<DB, 'statuses'>,
  statusId: string,
  url?: string
) =>
  url
    ? eb.or([eb('reply', '=', statusId), eb('reply', '=', url)])
    : eb('reply', '=', statusId)

const hydrateRows = async (
  db: Db,
  rows: StatusRow[],
  currentActorId?: string
): Promise<Status[]> => {
  // One batched context for the page, so hydration does not query per row.
  const hydrationContext = await buildStatusHydrationContext(
    db,
    rows,
    currentActorId
  )
  return (
    await Promise.all(
      rows.map((row) =>
        hydrateStatusRow(db, row, currentActorId, undefined, hydrationContext)
      )
    )
  ).filter((status): status is Status => status !== null)
}

export const getStatusReplies = async (
  db: Db,
  {
    statusId,
    url,
    limit,
    publicOnly = false,
    visibleToActorId,
    currentActorId,
    order = 'desc'
  }: GetStatusRepliesParams
): Promise<Status[]> => {
  let query = db
    .selectFrom('statuses')
    .selectAll()
    .where((eb) => repliesTo(eb, statusId, url))
    .orderBy('createdAt', order)
    .orderBy('id', order)

  if (publicOnly) {
    query = query.where((eb) => publiclyReadableStatus(db, eb))
  } else if (visibleToActorId) {
    query = query.where((eb) =>
      potentiallyReadableStatus(db, eb, visibleToActorId)
    )
  }

  if (limit) {
    query = lenientLimit(query, limit)
  }

  return hydrateRows(db, await query.execute(), currentActorId)
}

export const getActorStatusesCount = async (
  db: Db,
  { actorId, publicOnly = false }: GetActorStatusesCountParams
): Promise<number> => {
  if (publicOnly) {
    // There is no counter for this: an Announce is only publicly readable
    // while the status it boosts still is, and that status belongs to another
    // actor whose visibility edits and deletes never touch this actor's rows.
    // So the count is computed — but counted straight off the readable-ids
    // subquery, which is already scoped to this actor's statuses. Filtering
    // `statuses` by it re-applied the same `actorId` predicate through one
    // primary-key lookup per returned id, for a result the subquery had
    // already decided.
    //
    // One of the two readability call sites that keep the set-based form
    // (`getRebloggedBy` in ./interactions.ts is the other, for a different
    // reason recorded there). The correlated `publiclyReadableStatus` costs
    // one recursive-CTE instantiation per Announce row — a LIMIT amortises
    // that to a page, and a COUNT over the actor's whole history cannot
    // amortise it at all. On a PostgreSQL 18 seed shaped like production (an
    // actor with 1,889 publicly readable statuses, half of them Announces) the
    // correlated form read 40% fewer buffers and still took three times as
    // long: 15,421 buffers / 54ms against 25,752 / 18ms here. The two are
    // pinned as equivalent by
    // `lib/database/kysely/visibility/publiclyReadable.test.ts`; only their
    // plans differ.
    const result = await db
      .selectFrom(
        publiclyReadableStatusIds(
          db,
          db
            .selectFrom('statuses')
            .select('statuses.id')
            .where('actorId', '=', actorId)
        ).as('publicly_readable_actor_statuses')
      )
      .select((eb) =>
        eb.fn
          .count('publicly_readable_actor_statuses.id')
          .distinct()
          .as('count')
      )
      .limit(1)
      .executeTakeFirst()

    return parseInt(String(result?.count ?? '0'), 10)
  }

  return getCounterValue(db, CounterKey.totalStatus(actorId))
}

// Rows strictly past the cursor status in (createdAt, id) order. The cursor's
// own createdAt is compared as read; a NULL one is bound as NULL, which matches
// nothing.
const pastCursor = (
  eb: ExpressionBuilder<DB, 'statuses'>,
  cursor: { createdAt: EpochMs | null; id: string },
  operator: '<' | '>'
) => {
  const createdAt =
    cursor.createdAt === null
      ? sql<EpochMs>`${null}`
      : timestampValue(cursor.createdAt)
  return eb.or([
    eb('statuses.createdAt', operator, createdAt),
    eb.and([
      eb('statuses.createdAt', '=', createdAt),
      eb('statuses.id', operator, cursor.id)
    ])
  ])
}

export const getActorStatuses = async (
  db: Db,
  {
    actorId,
    currentActorId,
    minStatusId,
    maxStatusId,
    limit = PER_PAGE_LIMIT,
    publicOnly = false,
    visibleToActorId,
    includeFollowersOnly = false,
    followersAudience,
    onlyMedia = false,
    excludeReplies = false,
    excludeReblogs = false,
    tagged,
    pinned = false
  }: GetActorStatusesParams
): Promise<Status[]> => {
  let query = lenientLimit(
    db
      .selectFrom('statuses')
      .selectAll()
      .where('actorId', '=', actorId)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc'),
    limit
  )

  if (publicOnly) {
    // The one visibility mode that does NOT go through
    // `actorVisibleStatusIds`. That builder answers with a materialised id
    // set, which is right for the attachment and gallery filters
    // (`getAttachmentsForActor` builds the same set) — they have no ordered
    // bound to early-terminate on — and wrong here, because the planner must
    // finish it before this query's LIMIT sees a single row. It made the page
    // cost the actor's entire public history: a flat 33,311 buffers at every
    // page size on a production-shaped PostgreSQL 18 seed, against 476
    // correlated. The two forms select identical rows
    // (`lib/database/kysely/visibility/publiclyReadable.test.ts`),
    // so an attachment is still exactly as readable as the post carrying it —
    // which is the invariant sharing one builder was there to protect.
    query = query.where((eb) => publiclyReadableStatus(db, eb))
  } else {
    // A null subquery means the caller asked for no visibility filter at all
    // — the owner's own timeline and the full-history export both rely on
    // that. See `actorVisibleStatusIds`.
    const visibleStatusIds = actorVisibleStatusIds(db, actorId, {
      publicOnly,
      visibleToActorId,
      includeFollowersOnly,
      followersAudience
    })
    if (visibleStatusIds) {
      query = query.where('statuses.id', 'in', visibleStatusIds)
    }
  }

  if (onlyMedia) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('attachments')
          .select(sql.lit(1).as('one'))
          .whereRef('attachments.statusId', '=', 'statuses.id')
      )
    )
  }

  if (excludeReplies) {
    query = query.where((eb) =>
      eb.or([
        eb.or([
          eb('statuses.reply', 'is', null),
          eb('statuses.reply', '=', '')
        ]),
        eb.exists(
          eb
            .selectFrom('statuses as reply_parent_by_id')
            .select(sql.lit(1).as('one'))
            .where('reply_parent_by_id.actorId', '=', actorId)
            .whereRef('reply_parent_by_id.id', '=', 'statuses.reply')
        ),
        eb.exists(
          eb
            .selectFrom('statuses as reply_parent_by_url')
            .select(sql.lit(1).as('one'))
            .where('reply_parent_by_url.actorId', '=', actorId)
            .whereRef('reply_parent_by_url.urlHash', '=', 'statuses.replyHash')
            .whereRef('reply_parent_by_url.url', '=', 'statuses.reply')
        )
      ])
    )
  }

  if (excludeReblogs) {
    query = query.where((eb) =>
      eb.not(eb('statuses.type', '=', StatusType.enum.Announce))
    )
  }

  if (tagged !== undefined && tagged !== null) {
    const normalizedNames = getHashtagStorageNames(tagged)
    if (normalizedNames.length === 0) {
      query = query.where(sql<boolean>`1 = 0`)
    } else {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('tags')
            .select(sql.lit(1).as('one'))
            .whereRef('tags.statusId', '=', 'statuses.id')
            .where('tags.type', '=', 'hashtag')
            .where('tags.nameNormalized', 'in', normalizedNames)
        )
      )
    }
  }

  if (pinned) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('status_pins')
          .select(sql.lit(1).as('one'))
          .where('status_pins.actorId', '=', actorId)
          .whereRef('status_pins.statusId', '=', 'statuses.id')
      )
    )
  }

  const readCursor = (id: string) =>
    db
      .selectFrom('statuses')
      .selectAll()
      .where('id', '=', id)
      .limit(1)
      .executeTakeFirst()

  if (minStatusId) {
    const minStatus = await readCursor(minStatusId)
    if (minStatus) {
      query = query.where((eb) =>
        pastCursor(eb, { createdAt: minStatus.createdAt, id: minStatusId }, '>')
      )
    }
  }

  if (maxStatusId) {
    const maxStatus = await readCursor(maxStatusId)
    if (maxStatus) {
      query = query.where((eb) =>
        pastCursor(eb, { createdAt: maxStatus.createdAt, id: maxStatusId }, '<')
      )
    }
  }

  // Actor status lists back profile pages and the Mastodon
  // accounts/:id/statuses endpoint.
  return hydrateRows(db, await query.execute(), currentActorId)
}

export const getStatusesByIds = async (
  db: Db,
  {
    statusIds,
    currentActorId,
    visibleToActorId,
    withReplies
  }: GetStatusesByIdsParams
): Promise<Status[]> => {
  if (statusIds.length === 0) {
    return []
  }

  // Not chunked, as before: callers pass a page of ids.
  const uniqueStatusIds = [...new Set(statusIds)]
  let query = db
    .selectFrom('statuses')
    .selectAll()
    .where('id', 'in', uniqueStatusIds)
  if (visibleToActorId) {
    query = query.where((eb) =>
      potentiallyReadableStatus(db, eb, visibleToActorId)
    )
  }
  const statuses = await query.execute()
  const hydrationContext = await buildStatusHydrationContext(
    db,
    statuses,
    currentActorId
  )
  const statusMap = new Map(
    statuses.map((statusData) => [statusData.id, statusData] as const)
  )
  // In the order asked for, a repeated id once per time it was asked for.
  const orderedStatusData = statusIds
    .map((statusId) => statusMap.get(statusId))
    .filter((statusData): statusData is StatusRow => Boolean(statusData))
  return (
    await Promise.all(
      orderedStatusData.map((statusData) =>
        hydrateStatusRow(
          db,
          statusData,
          currentActorId,
          withReplies,
          hydrationContext
        )
      )
    )
  ).filter((status): status is Status => status !== null)
}

export const getStatusReblogsCount = (
  db: Db,
  { statusId }: GetStatusReblogsCountParams
): Promise<number> => getCounterValue(db, CounterKey.totalReblog(statusId))

const getStatusCounterValues = async (
  db: Db,
  { statusIds }: GetStatusCountsParams,
  getCounterId: (statusId: string) => string
): Promise<Record<string, number>> => {
  const uniqueStatusIds = [...new Set(statusIds)]
  const counterIdsByStatusId = new Map(
    uniqueStatusIds.map((statusId) => [statusId, getCounterId(statusId)])
  )
  const counterValueRows = await Promise.all(
    chunkArray([...counterIdsByStatusId.values()], getWhereInBatchSize(db)).map(
      (counterIds) => getCounterValues(db, counterIds)
    )
  )
  const counterValues = Object.assign({}, ...counterValueRows) as Record<
    string,
    number
  >

  return Object.fromEntries(
    uniqueStatusIds.map((statusId) => [
      statusId,
      counterValues[counterIdsByStatusId.get(statusId) ?? ''] ?? 0
    ])
  )
}

export const getStatusReblogsCounts = (
  db: Db,
  params: GetStatusCountsParams
): Promise<Record<string, number>> =>
  getStatusCounterValues(db, params, CounterKey.totalReblog)

export const getStatusRepliesCount = async (
  db: Db,
  { statusId, url, publicOnly = false }: GetStatusRepliesCountParams
): Promise<number> => {
  if (!url && !publicOnly) {
    return getCounterValue(db, CounterKey.totalReply(statusId))
  }

  let query = db
    .selectFrom('statuses')
    .where((eb) => repliesTo(eb, statusId, url))

  if (publicOnly) {
    query = query.where((eb) => publiclyReadableStatus(db, eb))
  }

  // The filter below is about the REPLY row, and still has to be: an
  // Announce whose boosted original is a public Note satisfies the
  // readability predicate under either form, so only this line keeps it out
  // of a reply count. What changed is why that needs saying. The
  // readable-ids subquery this replaced reported the resolved *original's*
  // type, so the two `type` tests were about different rows and reading them
  // as a duplicate was the trap; the correlated predicate tests the reply row
  // itself. Nothing writes `reply` on an Announce today either way, so
  // dropping this line still moves no number anyone can observe — which is
  // exactly why it needs saying at all.
  const result = await query
    .where((eb) => eb.not(eb('type', '=', StatusType.enum.Announce)))
    .select((eb) => eb.fn.countAll().as('count'))
    .limit(1)
    .executeTakeFirst()

  return parseInt(String(result?.count ?? '0'), 10)
}

export const getStatusRepliesCounts = (
  db: Db,
  params: GetStatusCountsParams
): Promise<Record<string, number>> =>
  getStatusCounterValues(db, params, CounterKey.totalReply)
