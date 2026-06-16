import crypto from 'node:crypto'

const REPLY_HASH_INDEX = 'statusesReplyHashIndex'
const BATCH_SIZE = 500

export const config = { transaction: false }

const getReplyHash = (reply) =>
  reply ? crypto.createHash('sha256').update(reply).digest('hex') : null

const hasIndex = async (knex, tableName, indexName) => {
  const client = knex.client.config.client

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const indexes = await knex.raw(`PRAGMA index_list('${tableName}')`)
    return indexes.some(({ name }) => name === indexName)
  }

  if (client === 'pg' || client === 'postgres' || client === 'postgresql') {
    const result = await knex
      .select('indexname')
      .from('pg_indexes')
      .where({ tablename: tableName, indexname: indexName })
      .first()
    return Boolean(result)
  }

  if (client === 'mysql' || client === 'mysql2') {
    const [rows] = await knex.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
      tableName,
      indexName
    ])
    return rows.length > 0
  }

  return false
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const up = async function up(knex) {
  const hasReplyHashColumn = await knex.schema.hasColumn(
    'statuses',
    'replyHash'
  )

  if (!hasReplyHashColumn) {
    await knex.schema.alterTable('statuses', function (table) {
      table.string('replyHash', 64).nullable()
    })
  }

  if (!(await hasIndex(knex, 'statuses', REPLY_HASH_INDEX))) {
    await knex.schema.alterTable('statuses', function (table) {
      table.index('replyHash', REPLY_HASH_INDEX)
    })
  }

  let lastId = ''

  while (true) {
    const statuses = await knex('statuses')
      .select('id', 'reply', 'replyHash')
      .where('id', '>', lastId)
      .orderBy('id')
      .limit(BATCH_SIZE)

    if (statuses.length === 0) break

    lastId = statuses[statuses.length - 1].id

    await Promise.all(
      statuses.map((status) => {
        const replyHash = getReplyHash(status.reply)
        if (status.replyHash === replyHash) return Promise.resolve()
        return knex('statuses').where('id', status.id).update({ replyHash })
      })
    )
  }
}

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
export const down = async function down(knex) {
  const hasReplyHashColumn = await knex.schema.hasColumn(
    'statuses',
    'replyHash'
  )

  if (!hasReplyHashColumn) return

  if (await hasIndex(knex, 'statuses', REPLY_HASH_INDEX)) {
    await knex.schema.alterTable('statuses', function (table) {
      table.dropIndex(['replyHash'], REPLY_HASH_INDEX)
    })
  }

  await knex.schema.alterTable('statuses', function (table) {
    table.dropColumn('replyHash')
  })
}
