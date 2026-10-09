import { Knex } from 'knex'

describe('SearchDatabase document migration', () => {
  const createTableMock = () => {
    const column = {
      defaultTo: vi.fn(() => column),
      notNullable: vi.fn(() => column),
      nullable: vi.fn(() => column),
      primary: vi.fn(() => column)
    }
    return {
      boolean: vi.fn(() => column),
      charset: vi.fn(),
      collate: vi.fn(),
      index: vi.fn(),
      integer: vi.fn(() => column),
      string: vi.fn(() => column),
      text: vi.fn(() => column),
      timestamp: vi.fn(() => column),
      unique: vi.fn()
    }
  }

  it('generates portable PostgreSQL and MySQL search table DDL', async () => {
    const migration =
      await import('@/migrations/20260523000000_add_search_documents.js')

    const pgRaw = vi.fn().mockResolvedValue(undefined)
    const pgSchema = {
      createTable: vi.fn().mockResolvedValue(undefined)
    }
    await migration.up({
      client: { config: { client: 'pg' } },
      schema: pgSchema,
      raw: pgRaw,
      fn: { now: vi.fn() }
    } as unknown as Knex)
    expect(pgRaw).toHaveBeenCalledWith(
      `CREATE INDEX search_documents_document_text_fts ON search_documents USING GIN (to_tsvector('simple', "documentText"))`
    )

    const mysqlRaw = vi.fn().mockResolvedValue(undefined)
    const mysqlTable = createTableMock()
    const mysqlSchema = {
      createTable: vi.fn(async (_tableName, callback) => {
        callback(mysqlTable)
      })
    }
    await migration.up({
      client: { config: { client: 'mysql2' } },
      schema: mysqlSchema,
      raw: mysqlRaw,
      fn: { now: vi.fn() }
    } as unknown as Knex)
    expect(mysqlRaw).toHaveBeenCalledWith(
      expect.stringContaining('FULLTEXT INDEX')
    )
    expect(mysqlTable.charset).toHaveBeenCalledWith('utf8mb4')
    expect(mysqlTable.collate).toHaveBeenCalledWith('utf8mb4_unicode_ci')
    expect(mysqlTable.index).toHaveBeenCalledWith(
      ['entityType', 'entityId'],
      'search_documents_entity_type_entity_id'
    )
    expect(mysqlTable.unique).not.toHaveBeenCalled()
  })
})
