import { type Kysely, SqliteAdapter, sql } from 'kysely'
import { createHash } from 'node:crypto'

// Adds `actor_handles`: the handle ledger. One row per handle an actor has
// held — the CURRENT row (`replacedAt` null, written by the mint paths and
// lazily by the rename) plus the retired ones (`replacedAt` set when the
// handle was given up by a rename or by the actor's deletion). A retired row
// keeps its handle reserved forever, so a renamed or deleted actor's handles
// and id path are never reissued, and an old handle still resolves to the
// actor that held it.
//
// The unique index is on (lower(username), domain) — case-folded and NOT
// partial — so at most one ledger row per handle exists across every actor,
// current or retired, on both backends. It is the same expression style as
// `actors_lower_username_domain_idx`.

const PAGE_SIZE = 200

// A deterministic id for a backfilled row, so running `up` twice mints the
// same id for the same actor. No lib/ import here, so the hash is inlined;
// the mint paths use generatePublicId instead.
const backfillHandleId = (actorId: string) =>
  `backfill-${createHash('sha256').update(actorId).digest('hex').slice(0, 40)}`

// The read side of a timestamp column, inlined (no lib/ import): the
// migrator's connection hands over epoch-ms numbers or Dates, and a bare
// SQLite CURRENT_TIMESTAMP text is UTC without a zone.
const backfillCreatedAtMs = (value: unknown): number => {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  const text = String(value).trim()
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)
    ? `${text.replace(' ', 'T')}Z`
    : text
  return new Date(normalized).getTime()
}

// oxlint-disable-next-line typescript/no-explicit-any
export const up = async (db: Kysely<any>): Promise<void> => {
  const isSqlite = db.getExecutor().adapter instanceof SqliteAdapter
  const timestampType = isSqlite ? 'datetime' : 'timestamptz'

  await db.schema
    .createTable('actor_handles')
    .ifNotExists()
    .addColumn('id', 'varchar(255)', (col) => col.primaryKey())
    .addColumn('actorId', 'varchar(255)', (col) => col.notNull())
    .addColumn('username', 'varchar(255)', (col) => col.notNull())
    .addColumn('domain', 'varchar(255)', (col) => col.notNull())
    .addColumn('createdAt', timestampType, (col) =>
      col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`)
    )
    // Null while the handle is the actor's current one.
    .addColumn('replacedAt', timestampType)
    .execute()

  await sql`CREATE UNIQUE INDEX IF NOT EXISTS "actor_handles_lower_username_domain_unique" ON "actor_handles" (lower("username"), "domain")`.execute(
    db
  )

  await db.schema
    .createIndex('actor_handles_actorId_replacedAt_idx')
    .ifNotExists()
    .on('actor_handles')
    .columns(['actorId', 'replacedAt'])
    .execute()

  // Backfill: one current ledger row per account-backed local actor, so a
  // rename (and the reservation it enforces) covers the actors that existed
  // before this table. Remote actors and the federation signer hold no row;
  // their handles stay unreserved.
  //
  // Case twins (two rows whose usernames fold together) cannot both get a
  // row — the unique index allows only one — so the OLDEST actor per folded
  // handle keeps it and a younger twin gets no row at all (its rename is
  // refused with `cannot_rename`, it does not silently take over the twin's
  // handle). Oldest wins is decided here in JS on (createdAt, id), so it does
  // not depend on the order the pages arrive in.
  //
  // Safe to run twice: each insert carries `where not exists` on the actorId,
  // so a second run writes nothing.
  interface BackfillCandidate {
    actorId: string
    username: string
    domain: string
    createdAt: number
  }
  const winners = new Map<string, BackfillCandidate>()
  // Keyset paging on `id` (never offset, at most 200 rows a page) — the
  // add_media_sort_at migration's pattern. A timestamp cursor cannot be
  // reused here: the migrator's connection hands the migration normalized
  // epoch-ms numbers, which PostgreSQL rejects as a timestamptz literal, and
  // SQLite stores dates as mixed INTEGER/TEXT that a rebound cursor would
  // misorder into an endless loop. `id` is a string on both backends, so the
  // cursor is always safe; the oldest-wins rule above, not the read order,
  // decides the winner.
  let lastId: string | null = null
  while (true) {
    let query = db
      .selectFrom('actors')
      .select(['id', 'username', 'domain', 'createdAt'])
      .where('accountId', 'is not', null)
      .where('privateKey', 'is not', null)
      .where('privateKey', '<>', '')
      .orderBy('id', 'asc')
      .limit(PAGE_SIZE)
    if (lastId !== null) {
      query = query.where('id', '>', lastId)
    }
    const rows = await query.execute()
    if (rows.length === 0) break

    for (const row of rows) {
      lastId = row.id
      const username = String(row.username ?? '')
      const domain = String(row.domain ?? '').toLowerCase()
      const key = `${username.toLowerCase()}|${domain}`
      const candidate: BackfillCandidate = {
        actorId: row.id,
        username,
        domain,
        // A tie on createdAt settles on the id — the same order the folded
        // actor lookups use.
        createdAt: backfillCreatedAtMs(row.createdAt)
      }
      const winner = winners.get(key)
      if (
        winner === undefined ||
        candidate.createdAt < winner.createdAt ||
        (candidate.createdAt === winner.createdAt &&
          candidate.actorId < winner.actorId)
      ) {
        winners.set(key, candidate)
      }
    }
  }

  for (const candidate of winners.values()) {
    const handleId = backfillHandleId(candidate.actorId)
    await db
      .insertInto('actor_handles')
      .columns([
        'id',
        'actorId',
        'username',
        'domain',
        'createdAt',
        'replacedAt'
      ])
      .expression((eb) =>
        eb
          .selectFrom('actors')
          .select([
            sql`${handleId}`.as('id'),
            sql`${candidate.actorId}`.as('actorId'),
            sql`${candidate.username}`.as('username'),
            // Stored lowercase; the ledger folds domains at write.
            sql`${candidate.domain}`.as('domain'),
            sql`"actors"."createdAt"`.as('createdAt'),
            sql`null`.as('replacedAt')
          ])
          .where('actors.id', '=', candidate.actorId)
          // The idempotency guard: an actor whose row exists (a previous
          // run) inserts nothing, rather than colliding on the unique
          // handle index.
          .where(
            sql<boolean>`not exists (select 1 from "actor_handles" ah where ah."actorId" = "actors"."id")`
          )
          .limit(1)
      )
      .execute()
  }
}

// oxlint-disable-next-line typescript/no-explicit-any
export const down = async (db: Kysely<any>): Promise<void> => {
  await db.schema
    .dropIndex('actor_handles_actorId_replacedAt_idx')
    .ifExists()
    .execute()
  await db.schema
    .dropIndex('actor_handles_lower_username_domain_unique')
    .ifExists()
    .execute()
  await db.schema.dropTable('actor_handles').ifExists().execute()
}
