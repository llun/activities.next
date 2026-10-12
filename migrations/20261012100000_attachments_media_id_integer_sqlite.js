/*
 * Stores `attachments.mediaId` as an integer on SQLite, as it already is on
 * PostgreSQL (see 20260207223000_fix_attachments_media_id_type).
 *
 * That migration only converted the column on PostgreSQL, so SQLite kept the
 * `varchar(255)` the column was created with (20260207213000) while
 * `medias.id`, the column it points at, is an integer on both. The mismatch
 * leaked into the application: the gallery compared the column with
 * `cast(medias.id as text)` to keep `attachments_mediaId_idx` usable, writes
 * had to normalise ids to their plain text form, and the tests, which run on
 * SQLite, exercised a column type PostgreSQL does not have.
 *
 * SQLite cannot change a column's type in place, so on SQLite this rebuilds
 * the table: the old table is renamed, the new one is created with the original
 * definition except `mediaId integer`, the rows are copied, the old table is
 * dropped and its indexes are re-created from their stored definitions
 * (`attachmentsIndex`, `attachments_actorId_idx`, `attachments_mediaId_idx`
 * and any other index the table has). Every other column keeps its type, its
 * default and its position, and `id` stays the primary key. Nothing references
 * `attachments` and it declares no foreign keys, so dropping the old table
 * fires no foreign key action and `PRAGMA foreign_keys` need not be switched
 * off (SQLite ignores that pragma inside a transaction anyway). The migration
 * checks that no table references `attachments` and refuses to run if one ever
 * does, because dropping the table would then act on the child rows. The whole
 * rebuild is one transaction, and it fails, rolling back, if the row count
 * changes or an index cannot be re-created.
 *
 * `mediaId` is copied by the rule the PostgreSQL migration applied (digits
 * only, at most 10 of them, at most 2147483647), widened to accept an all-zero
 * fraction such as '12.0', the form an id bound as a JS number used to be
 * stored in. A value that passes becomes `CAST(mediaId AS INTEGER)` ('012' and
 * '12.0' both become 12) and anything else becomes NULL: a value that is not a
 * whole number ('abc', '1.5', '12abc', ' 12', '-1', '1e3'), or one above
 * 2147483647, which no `medias` row can have. NULL is the column's normal value
 * for a remote attachment, so a NULLed row keeps its attachment and only loses
 * a pointer that could not match a media row. No such value is expected: every
 * writer stores a media row's id, and the outbox route rejects ids that are not
 * row ids.
 *
 * On PostgreSQL this is a no-op. `down` restores `varchar(255)` on SQLite
 * (integers become their text form, NULL stays NULL) and is a no-op on
 * PostgreSQL too.
 */

/**
 * @param { import("knex").Knex } knex
 * @returns { boolean }
 */
const isSqlite = (knex) =>
  knex.client.config.client === 'sqlite3' ||
  knex.client.config.client === 'better-sqlite3'

const TABLE = 'attachments'
const OLD_TABLE = 'attachments_old'

// The columns of `attachments` in table order, as in migrations/schema.sqlite.sql.
const COLUMNS = [
  'id',
  'statusId',
  'url',
  'mediaType',
  'type',
  'width',
  'height',
  'name',
  'createdAt',
  'updatedAt',
  'actorId',
  'mediaId',
  'blurhash',
  'focusX',
  'focusY',
  'thumbnailUrl',
  'playbackType'
]

/**
 * @param { string } mediaIdType the SQLite type of the `mediaId` column
 * @returns { string }
 */
const createTableSql = (mediaIdType) =>
  `CREATE TABLE \`${TABLE}\` (` +
  '`id` varchar(255), ' +
  '`statusId` varchar(255), ' +
  '`url` varchar(255), ' +
  '`mediaType` varchar(255), ' +
  '`type` varchar(255), ' +
  '`width` integer, ' +
  '`height` integer, ' +
  '`name` text, ' +
  '`createdAt` datetime default CURRENT_TIMESTAMP, ' +
  '`updatedAt` datetime default CURRENT_TIMESTAMP, ' +
  '`actorId` varchar(255), ' +
  `\`mediaId\` ${mediaIdType}, ` +
  '`blurhash` varchar(255) null, ' +
  '`focusX` float null, ' +
  '`focusY` float null, ' +
  '`thumbnailUrl` varchar(255) null, ' +
  '`playbackType` varchar(32) null, ' +
  'primary key (`id`))'

// `mediaId` as a whole number, or NULL. `whole` is `mediaId` with an all-zero
// fraction removed ('12.0' -> '12'); the 2147483647 bound and the ten-digit cap
// are the ones the PostgreSQL migration used.
const WHOLE_NUMBER_SQL = `CASE
  WHEN length(whole) BETWEEN 1 AND 10
    AND whole NOT GLOB '*[^0-9]*'
    AND CAST(whole AS INTEGER) <= 2147483647
  THEN CAST(whole AS INTEGER)
  ELSE NULL
END`

const WITHOUT_ZERO_FRACTION_SQL = `CASE
  WHEN mediaId GLOB '[0-9]*.0*'
    AND mediaId NOT GLOB '*[^0-9.]*'
    AND mediaId NOT GLOB '*.*[^0]*'
  THEN substr(mediaId, 1, instr(mediaId, '.') - 1)
  ELSE mediaId
END`

const columnList = (select) =>
  COLUMNS.map((column) => select(column)).join(', ')

/**
 * The type SQLite records for `attachments.mediaId`, or undefined without it.
 *
 * @param { import("knex").Knex } trx
 * @returns { Promise<string | undefined> }
 */
const getMediaIdType = async (trx) => {
  const columns = await trx.raw(`PRAGMA table_info(\`${TABLE}\`)`)
  const column = columns.find(({ name }) => name === 'mediaId')
  return column?.type?.toLowerCase()
}

/**
 * Rebuilds `attachments` with `mediaId` as `mediaIdType`. `mediaIdSql` is the expression the copied `mediaId` is read through and
 * `from` what the rows are read from; both can name the old table,
 * `attachments_old`.
 *
 * @param { import("knex").Knex } knex
 * @param { { mediaIdType: string, mediaIdSql: string, from: string } } rebuild
 * @returns { Promise<void> }
 */
const rebuildAttachments = async (knex, { mediaIdType, mediaIdSql, from }) => {
  await knex.transaction(async (trx) => {
    // Dropping the old table would run the foreign key actions of any table
    // that references it, so refuse to rebuild if one does.
    const referencing = await trx.raw(
      `SELECT m.name AS name
         FROM sqlite_master AS m, pragma_foreign_key_list(m.name) AS f
        WHERE m.type = 'table' AND lower(f."table") = '${TABLE}'`
    )
    if (referencing.length > 0) {
      throw new Error(
        `Cannot rebuild ${TABLE}: referenced by ${referencing
          .map(({ name }) => name)
          .join(', ')}`
      )
    }

    // Taken before the rename, which rewrites them to point at the old table.
    const indexes = await trx.raw(
      `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND tbl_name = '${TABLE}' AND sql IS NOT NULL
        ORDER BY rowid`
    )
    const [{ count: before }] = await trx.raw(
      `SELECT count(*) AS count FROM \`${TABLE}\``
    )

    await trx.raw(`ALTER TABLE \`${TABLE}\` RENAME TO \`${OLD_TABLE}\``)
    await trx.raw(createTableSql(mediaIdType))
    await trx.raw(
      `INSERT INTO \`${TABLE}\` (${columnList((column) => `\`${column}\``)})
       SELECT ${columnList((column) =>
         column === 'mediaId' ? mediaIdSql : `\`${column}\``
       )}
         FROM ${from}`
    )
    await trx.raw(`DROP TABLE \`${OLD_TABLE}\``)
    for (const { sql } of indexes) {
      await trx.raw(sql)
    }

    const [{ count: after }] = await trx.raw(
      `SELECT count(*) AS count FROM \`${TABLE}\``
    )
    if (after !== before) {
      throw new Error(
        `Rebuilding ${TABLE} changed its row count from ${before} to ${after}`
      )
    }
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  if (!isSqlite(knex)) return
  if ((await getMediaIdType(knex)) === 'integer') return

  await rebuildAttachments(knex, {
    mediaIdType: 'integer',
    mediaIdSql: WHOLE_NUMBER_SQL,
    from: `(SELECT *, ${WITHOUT_ZERO_FRACTION_SQL} AS whole FROM \`${OLD_TABLE}\`)`
  })
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const down = async (knex) => {
  if (!isSqlite(knex)) return
  if ((await getMediaIdType(knex)) !== 'integer') return

  await rebuildAttachments(knex, {
    mediaIdType: 'varchar(255)',
    mediaIdSql: 'CAST(`mediaId` AS TEXT)',
    from: `\`${OLD_TABLE}\``
  })
}
