const OAUTH_CLIENT_REFERENCE_ID_INDEX = 'oauth_client_reference_id_idx'

const hasIndex = async (trx, tableName, indexName) => {
  const client = trx.client.config.client

  if (client === 'better-sqlite3' || client === 'sqlite3') {
    const indexes = await trx.raw(`PRAGMA index_list('${tableName}')`)
    return indexes.some(({ name }) => name === indexName)
  }

  if (client === 'pg' || client === 'postgres' || client === 'postgresql') {
    const result = await trx
      .select('indexname')
      .from('pg_indexes')
      .where({ tablename: tableName, indexname: indexName })
      .first()
    return Boolean(result)
  }

  if (client === 'mysql' || client === 'mysql2') {
    const [rows] = await trx.raw('SHOW INDEX FROM ?? WHERE Key_name = ?', [
      tableName,
      indexName
    ])
    return rows.length > 0
  }

  return false
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
export const up = async (knex) => {
  await knex.transaction(async (trx) => {
    const hasReferenceId = await trx.schema.hasColumn(
      'oauthClient',
      'referenceId'
    )
    const hasMetadata = await trx.schema.hasColumn('oauthClient', 'metadata')

    if (!hasReferenceId) {
      await trx.schema.alterTable('oauthClient', (table) => {
        table.string('referenceId').notNullable().defaultTo('')
      })
    }

    await trx('oauthClient').whereNull('referenceId').update({
      referenceId: ''
    })

    if (
      !(await hasIndex(trx, 'oauthClient', OAUTH_CLIENT_REFERENCE_ID_INDEX))
    ) {
      await trx.schema.alterTable('oauthClient', (table) => {
        table.index(['referenceId'], OAUTH_CLIENT_REFERENCE_ID_INDEX)
      })
    }

    if (!hasMetadata) {
      await trx.schema.alterTable('oauthClient', (table) => {
        table.text('metadata').nullable()
      })
    }
  })
}

/**
 * @returns { Promise<void> }
 */
export const down = async () => {
  // Intentionally no-op: fresh databases may already have these columns from
  // the OAuth provider table migration, and current app code depends on them.
}
