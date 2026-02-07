/**
 * @param { import("knex").Knex } knex
 * @returns { boolean }
 */
const isPostgres = (knex) =>
  knex.client.config.client === 'pg' ||
  knex.client.config.client === 'postgresql'

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<{ data_type: string } | undefined> }
 */
const getMediaIdColumn = (knex) =>
  knex('information_schema.columns')
    .select('data_type')
    .where({
      table_name: 'attachments',
      column_name: 'mediaId'
    })
    .first()

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  if (!isPostgres(knex)) return

  const column = await getMediaIdColumn(knex)

  if (!column || column.data_type === 'integer') return

  await knex.raw('DROP INDEX IF EXISTS "attachments_mediaId_idx"')
  await knex.raw(`
    ALTER TABLE "attachments"
    ALTER COLUMN "mediaId" TYPE integer
    USING CASE
      WHEN "mediaId" ~ '^[0-9]{1,10}$' AND "mediaId"::bigint <= 2147483647 THEN "mediaId"::integer
      ELSE NULL
    END
  `)
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "attachments_mediaId_idx" ON "attachments" ("mediaId")'
  )
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  if (!isPostgres(knex)) return

  const column = await getMediaIdColumn(knex)

  if (!column || column.data_type !== 'integer') return

  await knex.raw('DROP INDEX IF EXISTS "attachments_mediaId_idx"')
  await knex.raw(`
    ALTER TABLE "attachments"
    ALTER COLUMN "mediaId" TYPE varchar(255)
    USING "mediaId"::varchar
  `)
  await knex.raw(
    'CREATE INDEX IF NOT EXISTS "attachments_mediaId_idx" ON "attachments" ("mediaId")'
  )
}
