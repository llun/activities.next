/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  const isPg =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql'
  if (!isPg) return

  const column = await knex('information_schema.columns')
    .select('data_type')
    .where({
      table_name: 'attachments',
      column_name: 'mediaId'
    })
    .first()

  if (!column || column.data_type === 'integer') return

  await knex.raw('DROP INDEX IF EXISTS "attachments_mediaId_idx"')
  await knex.raw(`
    ALTER TABLE "attachments"
    ALTER COLUMN "mediaId" TYPE integer
    USING CASE
      WHEN "mediaId" ~ '^[0-9]+$' THEN "mediaId"::integer
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
  const isPg =
    knex.client.config.client === 'pg' ||
    knex.client.config.client === 'postgresql'
  if (!isPg) return

  const column = await knex('information_schema.columns')
    .select('data_type')
    .where({
      table_name: 'attachments',
      column_name: 'mediaId'
    })
    .first()

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
