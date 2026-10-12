import { type Selectable, sql } from 'kysely'

import { decodeFavouritedByCursor } from '@/lib/database/domains/status/favouritedByCursor'
import type {
  FavouritedByAccount,
  GetFavouritedByParams,
  GetRebloggedByParams,
  RebloggedByAccount
} from '@/lib/database/domains/status/types'
import type { Db } from '@/lib/database/kysely'
import type { Statuses } from '@/lib/database/kysely/db'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { pastKeyset } from '@/lib/database/kysely/keyset'
import { potentiallyReadableStatus } from '@/lib/database/kysely/visibility/potentiallyReadable'
import { publiclyReadableStatusIds } from '@/lib/database/kysely/visibility/publiclyReadable'
import { StatusType } from '@/lib/types/domain/status'

// The accounts that favourited or boosted a status, a keyset page at a time.

export const getFavouritedBy = async (
  db: Db,
  { statusId, limit, maxId, minId, sinceId }: GetFavouritedByParams
): Promise<FavouritedByAccount[]> => {
  const olderCursorToken = maxId
  const newerCursorToken = minId || sinceId

  // Reject malformed cursors with an empty page instead of scanning from the
  // top, matching the favourites/bookmarks pagination contract.
  if (
    (olderCursorToken && !decodeFavouritedByCursor(olderCursorToken)) ||
    (newerCursorToken && !decodeFavouritedByCursor(newerCursorToken))
  ) {
    return []
  }

  const olderCursor = decodeFavouritedByCursor(olderCursorToken)
  const newerCursor = decodeFavouritedByCursor(newerCursorToken)
  const direction = minId ? 'asc' : 'desc'

  const rows = await db
    .selectFrom('likes')
    .selectAll()
    .where('statusId', '=', statusId)
    .$if(olderCursor !== null, (qb) =>
      qb.where((eb) =>
        pastKeyset(
          eb,
          {
            createdAt: olderCursor!.createdAt,
            tieBreaker: olderCursor!.actorId
          },
          '<',
          'actorId'
        )
      )
    )
    .$if(newerCursor !== null, (qb) =>
      qb.where((eb) =>
        pastKeyset(
          eb,
          {
            createdAt: newerCursor!.createdAt,
            tieBreaker: newerCursor!.actorId
          },
          '>',
          'actorId'
        )
      )
    )
    .orderBy('createdAt', direction)
    .orderBy('actorId', direction)
    .limit(limit)
    .execute()

  const ordered = minId ? rows.reverse() : rows
  return ordered.map((row) => ({
    actorId: row.actorId,
    // getCompatibleTime threw a TypeError on a NULL timestamp; it reads as 0.
    createdAt: row.createdAt ?? 0
  }))
}

type ReblogRow = Pick<Selectable<Statuses>, 'id' | 'actorId' | 'createdAt'>

// The actors who boosted `statusId`, one row per actor (their newest boost),
// newest first. `visibleToActorId` keeps the boosts that viewer may read;
// without one, only the publicly readable boosts.
export const getRebloggedBy = async (
  db: Db,
  {
    statusId,
    limit,
    maxStatusId,
    minStatusId,
    sinceStatusId,
    visibleToActorId
  }: GetRebloggedByParams
): Promise<RebloggedByAccount[]> => {
  // The Announces of `statusId`: by `originalStatusId`, or for a legacy row
  // the id it wrote into `content`.
  const reblogBase = () =>
    db
      .selectFrom('statuses')
      .where('statuses.type', '=', StatusType.enum.Announce)
      .where((eb) =>
        eb.or([
          eb('statuses.originalStatusId', '=', statusId),
          eb.and([
            eb('statuses.originalStatusId', 'is', null),
            eb('statuses.content', '=', statusId)
          ])
        ])
      )

  const visibleReblogs = () =>
    reblogBase()
      .select(['statuses.id', 'statuses.actorId', 'statuses.createdAt'])
      .where((eb) =>
        visibleToActorId
          ? potentiallyReadableStatus(db, eb, visibleToActorId)
          : // The set-based readability form, for the same reason
            // `getActorStatusesCount` uses it — but far more sharply here.
            // `visibleReblogs` is embedded TWICE below: once as the
            // `visible_reblogs` FROM subquery and again inside the correlated
            // `not exists` that keeps only each actor's newest reblog. A
            // correlated readability predicate is therefore re-evaluated per
            // row PAIR, instantiating one recursive CTE each time, while a
            // materialised id set is computed once and reused by both copies.
            //
            // The rows it would be evaluated over are not this status's
            // reblogs either. `reblogBase`'s legacy `originalStatusId IS NULL`
            // branch has no index to narrow it —
            // `statuses_announce_original_actor_idx` covers
            // `(type, "originalStatusId", "actorId")` and nothing indexes
            // `content` — so every pre-backfill Announce in the instance is a
            // candidate row the planner must filter, and the correlated cost
            // tracks instance-wide legacy Announce volume rather than this
            // status. The final result set is unaffected; only the work to
            // reach it.
            //
            // Measured on the production-shaped PostgreSQL 18 seed (with the
            // Knex form of this query): 49,474 buffers / 33ms set-based
            // against 11,383 / 415ms correlated — four times fewer buffers and
            // twelve times the wall clock. Shipped correlated once and caught
            // in review; `publiclyReadableStatusQueryShape.test.ts` pins it.
            eb(
              'statuses.id',
              'in',
              publiclyReadableStatusIds(db, reblogBase().select('statuses.id'))
            )
      )

  const lookupCursor = async (id: string) =>
    (await visibleReblogs()
      .where('statuses.id', '=', id)
      .limit(1)
      .executeTakeFirst()) ?? null

  const [maxCursor, minCursor, sinceCursor] = await Promise.all([
    maxStatusId ? lookupCursor(maxStatusId) : null,
    minStatusId ? lookupCursor(minStatusId) : null,
    sinceStatusId ? lookupCursor(sinceStatusId) : null
  ])
  if (maxStatusId && !maxCursor) return []
  if (minStatusId && !minCursor) return []
  if (sinceStatusId && !sinceCursor) return []

  const cursors: [ReblogRow | null, '<' | '>'][] = [
    [maxCursor, '<'],
    [minCursor, '>'],
    [sinceCursor, '>']
  ]

  const direction = minStatusId ? 'asc' : 'desc'
  let query = db
    .selectFrom(visibleReblogs().as('visible_reblogs'))
    .select([
      'visible_reblogs.id',
      'visible_reblogs.actorId',
      'visible_reblogs.createdAt'
    ])
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom(visibleReblogs().as('newer_reblogs'))
            .select(sql.lit(1).as('one'))
            .whereRef('newer_reblogs.actorId', '=', 'visible_reblogs.actorId')
            .where((newer) =>
              newer.or([
                newer(
                  'newer_reblogs.createdAt',
                  '>',
                  newer.ref('visible_reblogs.createdAt')
                ),
                newer.and([
                  newer(
                    'newer_reblogs.createdAt',
                    '=',
                    newer.ref('visible_reblogs.createdAt')
                  ),
                  newer(
                    'newer_reblogs.id',
                    '>',
                    newer.ref('visible_reblogs.id')
                  )
                ])
              ])
            )
        )
      )
    )
    .orderBy('visible_reblogs.createdAt', direction)
    .orderBy('visible_reblogs.id', direction)

  // Rows strictly past each cursor in (createdAt, id) order. A cursor boost
  // with no createdAt reads the other undated boosts past its id: Knex's tie
  // arm was the two-argument where('createdAt', null), so IS NULL.
  for (const [cursor, operator] of cursors) {
    if (!cursor) continue
    if (cursor.createdAt === null) {
      query = query.where((eb) =>
        eb.and([
          eb('visible_reblogs.createdAt', 'is', null),
          eb('visible_reblogs.id', operator, cursor.id)
        ])
      )
      continue
    }
    const createdAt = timestampValue(cursor.createdAt)
    query = query.where((eb) =>
      eb.or([
        eb('visible_reblogs.createdAt', operator, createdAt),
        eb.and([
          eb('visible_reblogs.createdAt', '=', createdAt),
          eb('visible_reblogs.id', operator, cursor.id)
        ])
      ])
    )
  }

  if (typeof limit === 'number') {
    query = query.limit(limit)
  }

  const rows = await query.execute()
  const ordered = minStatusId ? rows.reverse() : rows
  return ordered.map((row) => ({
    actorId: row.actorId as string,
    statusId: row.id
  }))
}
