const SEARCH_DOCUMENTS_TABLE = 'search_documents'
const SQLITE_FTS_TABLE = 'search_documents_fts'

const SQLITE_CLIENTS = new Set(['sqlite3', 'better-sqlite3'])
const POSTGRES_CLIENTS = new Set(['pg', 'postgres', 'postgresql'])
const MYSQL_CLIENTS = new Set(['mysql', 'mysql2'])

const getClientName = (knex) => String(knex.client.config.client).toLowerCase()

const isSQLite = (knex) => SQLITE_CLIENTS.has(getClientName(knex))

const isPostgres = (knex) => POSTGRES_CLIENTS.has(getClientName(knex))

const isMySQL = (knex) => MYSQL_CLIENTS.has(getClientName(knex))

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async (knex) => {
  await knex.schema.createTable(SEARCH_DOCUMENTS_TABLE, (table) => {
    if (isMySQL(knex)) {
      table.charset('utf8mb4')
      table.collate('utf8mb4_unicode_ci')
    }

    table.string('id', 320).primary()
    table.string('entityType', 32).notNullable()
    table.string('entityId', 255).notNullable()
    table.text('documentText').notNullable()
    table.string('actorId', 255).nullable()
    table.string('visibility', 32).nullable()
    table.timestamp('entityCreatedAt', { useTz: true }).nullable()
    table.boolean('discoverable').nullable()
    table.integer('postCount').nullable()
    table.timestamp('lastPostAt', { useTz: true }).nullable()
    table.timestamp('createdAt', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('updatedAt', { useTz: true }).defaultTo(knex.fn.now())

    table.index(['entityType'], 'search_documents_entity_type')
    table.index(['actorId'], 'search_documents_actor')
    table.index(['entityCreatedAt'], 'search_documents_entity_created')
    table.index(['postCount'], 'search_documents_post_count')
    table.index(['lastPostAt'], 'search_documents_last_post')
  })

  if (isSQLite(knex)) {
    await knex.raw(
      `CREATE VIRTUAL TABLE ${SQLITE_FTS_TABLE} USING fts5(id UNINDEXED, documentText, content='${SEARCH_DOCUMENTS_TABLE}', content_rowid='rowid')`
    )
    await knex.raw(`
      CREATE TRIGGER search_documents_ai AFTER INSERT ON ${SEARCH_DOCUMENTS_TABLE} BEGIN
        INSERT INTO ${SQLITE_FTS_TABLE}(rowid, id, documentText)
        VALUES (new.rowid, new.id, new.documentText);
      END
    `)
    await knex.raw(`
      CREATE TRIGGER search_documents_ad AFTER DELETE ON ${SEARCH_DOCUMENTS_TABLE} BEGIN
        INSERT INTO ${SQLITE_FTS_TABLE}(${SQLITE_FTS_TABLE}, rowid, id, documentText)
        VALUES ('delete', old.rowid, old.id, old.documentText);
      END
    `)
    await knex.raw(`
      CREATE TRIGGER search_documents_au AFTER UPDATE ON ${SEARCH_DOCUMENTS_TABLE} BEGIN
        INSERT INTO ${SQLITE_FTS_TABLE}(${SQLITE_FTS_TABLE}, rowid, id, documentText)
        VALUES ('delete', old.rowid, old.id, old.documentText);
        INSERT INTO ${SQLITE_FTS_TABLE}(rowid, id, documentText)
        VALUES (new.rowid, new.id, new.documentText);
      END
    `)
  } else if (isPostgres(knex)) {
    await knex.raw(
      `CREATE INDEX search_documents_document_text_fts ON ${SEARCH_DOCUMENTS_TABLE} USING GIN (to_tsvector('simple', "documentText"))`
    )
  } else if (isMySQL(knex)) {
    await knex.raw(
      `ALTER TABLE ${SEARCH_DOCUMENTS_TABLE} ADD FULLTEXT INDEX search_documents_document_text_fts (documentText)`
    )
  }
}

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async (knex) => {
  if (isSQLite(knex)) {
    await knex.raw('DROP TRIGGER IF EXISTS search_documents_au')
    await knex.raw('DROP TRIGGER IF EXISTS search_documents_ad')
    await knex.raw('DROP TRIGGER IF EXISTS search_documents_ai')
    await knex.raw(`DROP TABLE IF EXISTS ${SQLITE_FTS_TABLE}`)
  } else if (isPostgres(knex)) {
    await knex.raw('DROP INDEX IF EXISTS search_documents_document_text_fts')
  } else if (isMySQL(knex)) {
    await knex.raw(
      `ALTER TABLE ${SEARCH_DOCUMENTS_TABLE} DROP INDEX search_documents_document_text_fts`
    )
  }

  await knex.schema.dropTableIfExists(SEARCH_DOCUMENTS_TABLE)
}
