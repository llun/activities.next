import { type Kysely, SqliteAdapter } from 'kysely'

import { toEpochMilliseconds } from '@/lib/database/kysely/normalize'

// Adds `medias.sortAt`: the date a photo sorts by in the gallery, `takenAt`
// when known and `createdAt` otherwise, indexed with the owner and id for
// keyset paging. It is nullable because SQLite cannot ADD COLUMN NOT NULL
// without a constant default; the backfill below and the write paths leave it
// set on every row. It is written as a JS Date, never SQL arithmetic, so both
// backends store the same instant (SQLite holds mixed INTEGER/TEXT dates in
// takenAt and createdAt, which `toEpochMilliseconds` normalises).
// Safe to run twice: the column, the backfill and the index are all guarded.

const BATCH_SIZE = 500

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const tables = await db.introspection.getTables()
  const columns = tables.find((table) => table.name === 'medias')?.columns ?? []
  if (!columns.some((column) => column.name === 'sortAt')) {
    const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
    await db.schema
      .alterTable('medias')
      .addColumn('sortAt', isSqlite ? 'datetime' : 'timestamptz')
      .execute()
  }

  let lastId = 0
  while (true) {
    const rows = await db
      .selectFrom('medias')
      .select(['id', 'takenAt', 'createdAt', 'updatedAt'])
      .where('sortAt', 'is', null)
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)
      .execute()
    if (rows.length === 0) break
    for (const row of rows) {
      const ms =
        [row.takenAt, row.createdAt, row.updatedAt]
          .map(toEpochMilliseconds)
          .find((value) => value !== null && !Number.isNaN(value)) ?? 0
      await db
        .updateTable('medias')
        .set({ sortAt: new Date(ms) })
        .where('id', '=', row.id)
        // A date edited since the SELECT already set sortAt; keep it.
        .where('sortAt', 'is', null)
        .execute()
    }
    lastId = rows[rows.length - 1].id
  }

  await db.schema
    .createIndex('medias_actorId_sortAt_id_idx')
    .ifNotExists()
    .on('medias')
    .columns(['actorId', 'sortAt', 'id'])
    .execute()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema.dropIndex('medias_actorId_sortAt_id_idx').ifExists().execute()
  await db.schema.alterTable('medias').dropColumn('sortAt').execute()
}
