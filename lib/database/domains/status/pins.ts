import type {
  GetPinnedStatusIdsParams,
  PinStatusParams
} from '@/lib/database/domains/status/types'
import { type Db, inTransaction } from '@/lib/database/kysely'
import { forUpdate } from '@/lib/database/kysely/dialect'
import { selectInChunks } from '@/lib/database/kysely/inList'

// An actor's pinned statuses (`status_pins`, keyed by actorId and statusId).

// Pins `statusId` for `actorId`. With `maxPinnedStatuses`, the actor's row is
// locked first so concurrent pins of the same actor count one after the
// other: an existing pin is reported as pinned, and a new one is refused
// (false) once the actor has that many.
export const pinStatus = async (
  db: Db,
  { actorId, statusId, maxPinnedStatuses }: PinStatusParams
): Promise<boolean> => {
  // Knex refused an undefined key in the capped path's lookups ("Undefined
  // binding(s) detected"), and the NOT NULL columns refused a missing key at
  // the insert. Kysely would bind either as NULL, lock nothing and count
  // nothing on the way there, so a missing key is refused before any query.
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
      if (existingPin) return true

      const countRow = await trx
        .selectFrom('status_pins')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('actorId', '=', actorId)
        .executeTakeFirst()
      if (Number(countRow?.count ?? 0) >= maxPinnedStatuses) return false
    }

    await trx
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
      .execute()
    return true
  })
}

export const unpinStatus = async (
  db: Db,
  { actorId, statusId }: PinStatusParams
): Promise<void> => {
  await db
    .deleteFrom('status_pins')
    .where('actorId', '=', actorId)
    .where('statusId', '=', statusId)
    .execute()
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
