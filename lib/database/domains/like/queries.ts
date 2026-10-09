import type { ExpressionBuilder } from 'kysely'

import type {
  CreateLikeParams,
  DeleteLikeParams,
  GetLikeCountParams,
  GetLikesParams,
  IsActorLikedStatusParams,
  Like
} from '@/lib/database/domains/like/types'
import { type DB, type Db, inTransaction } from '@/lib/database/kysely'
import {
  decreaseCounterValue,
  getCounterValue,
  increaseCounterValue
} from '@/lib/database/kysely/counter'
import { timestampValue } from '@/lib/database/kysely/dialect'
import { CounterKey } from '@/lib/database/sql/utils/counter'
import {
  type FavouriteCursor,
  decodeFavouriteCursor
} from '@/lib/database/sql/utils/favouriteCursor'

// Rows strictly older (`<`) or newer (`>`) than the cursor in
// (createdAt, statusId) order.
const pastCursor = (
  eb: ExpressionBuilder<DB, 'likes'>,
  cursor: FavouriteCursor,
  operator: '<' | '>'
) => {
  const createdAt = timestampValue(cursor.createdAt)
  return eb.or([
    eb('createdAt', operator, createdAt),
    eb.and([
      eb('createdAt', '=', createdAt),
      eb('statusId', operator, cursor.statusId)
    ])
  ])
}

export const createLike = (
  db: Db,
  { actorId, statusId }: CreateLikeParams
): Promise<boolean> =>
  inTransaction(db, async (trx) => {
    const status = await trx
      .selectFrom('statuses')
      .select('id')
      .where('id', '=', statusId)
      .executeTakeFirst()
    if (!status) return false

    const existing = await trx
      .selectFrom('likes')
      .select('statusId')
      .where('actorId', '=', actorId)
      .where('statusId', '=', statusId)
      .executeTakeFirst()
    if (existing) return false

    const currentTime = new Date()
    await trx
      .insertInto('likes')
      .values({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .execute()
    await increaseCounterValue(
      trx,
      CounterKey.totalLike(statusId),
      1,
      currentTime
    )
    return true
  })

export const deleteLike = (
  db: Db,
  { actorId, statusId }: DeleteLikeParams
): Promise<void> =>
  inTransaction(db, async (trx) => {
    const { numDeletedRows } = await trx
      .deleteFrom('likes')
      .where('actorId', '=', actorId)
      .where('statusId', '=', statusId)
      .executeTakeFirst()
    const deleted = Number(numDeletedRows)
    if (!deleted) return

    await decreaseCounterValue(
      trx,
      CounterKey.totalLike(statusId),
      deleted,
      new Date()
    )
  })

export const getLikeCount = (
  db: Db,
  { statusId }: GetLikeCountParams
): Promise<number> => getCounterValue(db, CounterKey.totalLike(statusId))

export const isActorLikedStatus = async (
  db: Db,
  { actorId, statusId }: IsActorLikedStatusParams
): Promise<boolean> => {
  const row = await db
    .selectFrom('likes')
    .select('statusId')
    .where('statusId', '=', statusId)
    .where('actorId', '=', actorId)
    .limit(1)
    .executeTakeFirst()
  return Boolean(row)
}

export const getLikes = async (
  db: Db,
  { actorId, limit, maxId, minId, sinceId }: GetLikesParams
): Promise<Like[]> => {
  const olderCursorToken = maxId
  const newerCursorToken = minId || sinceId
  const olderCursor = decodeFavouriteCursor(olderCursorToken)
  const newerCursor = decodeFavouriteCursor(newerCursorToken)

  // Reject malformed cursors with an empty page instead of scanning from the
  // top, matching the bookmarks pagination contract.
  if (
    (olderCursorToken && !olderCursor) ||
    (newerCursorToken && !newerCursor)
  ) {
    return []
  }

  // min_id pages upward from the cursor (oldest first, then reversed);
  // max_id and since_id page from the newest.
  const direction = minId ? 'asc' : 'desc'
  let query = db
    .selectFrom('likes')
    .select(['actorId', 'statusId', 'createdAt'])
    .where('actorId', '=', actorId)
  if (olderCursor) {
    query = query.where((eb) => pastCursor(eb, olderCursor, '<'))
  }
  if (newerCursor) {
    query = query.where((eb) => pastCursor(eb, newerCursor, '>'))
  }
  const rows = await query
    .orderBy('createdAt', direction)
    .orderBy('statusId', direction)
    .limit(limit)
    .execute()

  const ordered = minId ? rows.reverse() : rows
  return ordered.map((row) => ({
    actorId: row.actorId,
    statusId: row.statusId,
    // Nullable in the schema, but every writer sets it.
    createdAt: row.createdAt ?? 0
  }))
}

// The facade getSQLDatabase binds with bindDb().
export const likeQueries = {
  createLike,
  deleteLike,
  getLikeCount,
  isActorLikedStatus,
  getLikes
}
