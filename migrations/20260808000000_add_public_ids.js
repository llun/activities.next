import { v7 } from 'uuid'

export const config = { transaction: false }

const SQLITE_UTC_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/

const toDate = (value) => {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    const normalized = SQLITE_UTC_TIMESTAMP_PATTERN.test(trimmed)
      ? `${trimmed.replace(' ', 'T')}Z`
      : trimmed
    return new Date(normalized)
  }
  return new Date(value)
}

const mintPublicId = (createdAt) => {
  const time = toDate(createdAt).getTime()
  const msecs = Number.isFinite(time) && time >= 0 ? time : 0
  return v7({ msecs })
}

const addPublicIdColumn = async (knex, tableName, indexName) => {
  const hasColumn = await knex.schema.hasColumn(tableName, 'publicId')
  if (hasColumn) {
    console.log(`${tableName}.publicId already exists, skipping schema change`)
    return
  }
  console.log(`Adding publicId to ${tableName}...`)
  await knex.schema.alterTable(tableName, (table) => {
    table.string('publicId', 36).nullable()
    table.unique(['publicId'], { indexName })
  })
}

const backfillPublicIds = async (knex, tableName) => {
  const totalResult = await knex(tableName).count('* as cnt').first()
  const total = Number(totalResult.cnt)
  console.log(`Backfilling publicId for ${total} ${tableName} rows...`)

  const BATCH_SIZE = 500
  let lastId = ''
  let processed = 0
  let updated = 0

  while (true) {
    const rows = await knex(tableName)
      .select('id', 'createdAt', 'publicId')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)
    if (rows.length === 0) break

    lastId = rows[rows.length - 1].id

    const updatePromises = []
    for (const row of rows) {
      if (row.publicId) continue
      updatePromises.push(
        knex(tableName)
          .where('id', row.id)
          .whereNull('publicId')
          .update({ publicId: mintPublicId(row.createdAt) })
      )
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises)
      updated += updatePromises.length
    }

    processed += rows.length
    console.log(
      `  ${tableName}: ${processed}/${total} (${total === 0 ? 100 : Math.round((processed / total) * 100)}%) - ${updated} updated`
    )
  }

  console.log(`Done. ${tableName}: processed ${processed}, updated ${updated}.`)
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function up(knex) {
  await addPublicIdColumn(knex, 'statuses', 'statuses_publicid_unique')
  await addPublicIdColumn(knex, 'actors', 'actors_publicid_unique')
  await backfillPublicIds(knex, 'statuses')
  await backfillPublicIds(knex, 'actors')
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function down(knex) {
  for (const [tableName, indexName] of [
    ['statuses', 'statuses_publicid_unique'],
    ['actors', 'actors_publicid_unique']
  ]) {
    const hasColumn = await knex.schema.hasColumn(tableName, 'publicId')
    if (hasColumn) {
      await knex.schema.alterTable(tableName, (table) => {
        table.dropUnique(['publicId'], indexName)
        table.dropColumn('publicId')
      })
    }
  }
}
