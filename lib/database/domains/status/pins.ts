import type {
  GetPinnedStatusIdsParams,
  PinStatusParams,
  PinStatusResult
} from '@/lib/database/domains/status/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'

// An actor's pinned statuses (`status_pins`, keyed by actorId and statusId).

// Pins `statusId` for `actorId` and reports both whether the status is pinned
// after the call (`pinned`) and whether this call inserted a new row (`isNew`).
// With `maxPinnedStatuses`, the actor's row is locked first so concurrent pins
// of the same actor count one after the other: an existing pin is reported as
// `{ pinned: true, isNew: false }`, and a new one is refused (`pinned: false`)
// once the actor has that many.
export const pinStatusWithResult = async (
  db: Db,
  { actorId, statusId, maxPinnedStatuses }: PinStatusParams
): Promise<PinStatusResult> => {
  // The NOT NULL columns refuse a missing key at the insert, but the capped
  // path's lookups would bind it as NULL, lock nothing and count nothing on
  // the way there, so a missing key is refused before any query.
  if (actorId === undefined || actorId === null) {
    throw new Error('pinStatus requires an actorId')
  }
  if (statusId === undefined || statusId === null) {
    throw new Error('pinStatus requires a statusId')
  }

  const currentTime = new Date()
  return inTransaction(db, async (trx) => {
    if (maxPinnedStatuses !== undefined) {
      await forUpdate(
        trx,
        trx.selectFrom('actors').select('id').where('id', '=', actorId)
      ).execute()

      const existingPin = await trx
        .selectFrom('status_pins')
        .select('statusId')
        .where('actorId', '=', actorId)
        .where('statusId', '=', statusId)
        .limit(1)
        .executeTakeFirst()
      if (existingPin) return { pinned: true, isNew: false }

      const countRow = await trx
        .selectFrom('status_pins')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('actorId', '=', actorId)
        .executeTakeFirst()
      if (Number(countRow?.count ?? 0) >= maxPinnedStatuses) {
        return { pinned: false, isNew: false }
      }
    }

    const insertResult = await trx
      .insertInto('status_pins')
      .values({
        actorId,
        statusId,
        createdAt: currentTime,
        updatedAt: currentTime
      })
      .onConflict((conflict) =>
        conflict.columns(['actorId', 'statusId']).doNothing()
      )
      .executeTakeFirst()
    return {
      pinned: true,
      isNew: Number(insertResult.numInsertedOrUpdatedRows ?? 0) > 0
    }
  })
}

export const pinStatus = async (
  db: Db,
  params: PinStatusParams
): Promise<boolean> => (await pinStatusWithResult(db, params)).pinned

export const unpinStatus = async (
  db: Db,
  { actorId, statusId }: PinStatusParams
): Promise<boolean> => {
  const { numDeletedRows } = await db
    .deleteFrom('status_pins')
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .executeTakeFirst()
  return Number(numDeletedRows) > 0
}

// The actor's pinned status ids, newest pin first (ties by statusId,
// descending). With `statusIds`, only those among them.
export const getPinnedStatusIds = async (
  db: Db,
  { actorId, statusIds }: GetPinnedStatusIdsParams
): Promise<string[]> => {
  if (statusIds && statusIds.length === 0) return []

  if (statusIds) {
    const uniqueStatusIds = [...new Set(statusIds)]
    // One value of each statement is the actorId.
    const rows = await selectInChunks(
      db,
      uniqueStatusIds,
      (chunk) =>
        db
          .selectFrom('status_pins')
          .select(['statusId', 'createdAt'])
          .where('actorId', '=', actorId)
          .where('statusId', 'in', chunk)
          .execute(),
      1
    )

    // The chunks come back unordered, so the order is applied here, as the
    // query below does it. Number(null) is 0, as new Date(null) was.
    return rows
      .sort((a, b) => {
        const timeA = Number(a.createdAt)
        const timeB = Number(b.createdAt)
        if (timeA !== timeB) return timeB - timeA
        return b.statusId.localeCompare(a.statusId)
      })
      .map((row) => row.statusId)
  }

  const rows = await db
    .selectFrom('status_pins')
    .select('statusId')
    .where('actorId', '=', actorId)
    .orderBy('createdAt', 'desc')
    .orderBy('statusId', 'desc')
    .execute()
  return rows.map((row) => row.statusId)
}
