import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getSearchTokens } from '@/lib/database/sql/search'

describe('SearchDatabase foundation', () => {
  it('tokenizes Unicode search text', () => {
    expect(getSearchTokens('  Café 東京 runner_1  ')).toEqual([
      'café',
      '東京',
      'runner_1'
    ])
  })

  it('creates SQLite FTS search documents and returns full-text matches', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)

    try {
      await database.migrate()
      await database.upsertSearchDocument({
        entityType: 'account',
        entityId: 'https://remote.test/users/alice',
        documentText: 'alice alice@remote.test Trail runner',
        actorId: 'https://remote.test/users/alice',
        discoverable: true
      })

      const ftsRows = await knexDatabase.raw(
        'select id from search_documents_fts where search_documents_fts match ?',
        ['runner']
      )
      expect(ftsRows).toEqual([
        { id: 'account:https://remote.test/users/alice' }
      ])

      await expect(
        database.searchDocuments({
          entityType: 'account',
          q: 'runner',
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityType: 'account',
          entityId: 'https://remote.test/users/alice'
        })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('filters generic search documents by discoverability and status visibility', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)

    try {
      await database.migrate()
      await database.upsertSearchDocument({
        entityType: 'account',
        entityId: 'https://remote.test/users/public-runner',
        documentText: 'runner public account',
        actorId: 'https://remote.test/users/public-runner',
        discoverable: true
      })
      await database.upsertSearchDocument({
        entityType: 'account',
        entityId: 'https://remote.test/users/hidden-runner',
        documentText: 'runner hidden account',
        actorId: 'https://remote.test/users/hidden-runner',
        discoverable: false
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/public-runner/statuses/1',
        documentText: 'runner public status',
        actorId: 'https://remote.test/users/public-runner',
        visibility: 'public'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/hidden-runner/statuses/1',
        documentText: 'runner private status',
        actorId: 'https://remote.test/users/hidden-runner',
        visibility: 'private'
      })

      await expect(
        database.searchDocuments({
          q: 'runner',
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityId: 'https://remote.test/users/public-runner/statuses/1'
        }),
        expect.objectContaining({
          entityId: 'https://remote.test/users/public-runner'
        })
      ])

      await expect(
        database.searchDocuments({
          entityType: 'account',
          q: 'runner',
          limit: 10,
          includeNonDiscoverable: true
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityId: 'https://remote.test/users/public-runner'
        }),
        expect.objectContaining({
          entityId: 'https://remote.test/users/hidden-runner'
        })
      ])

      await expect(
        database.searchDocuments({
          entityType: 'status',
          q: 'runner',
          limit: 10,
          visibleToActorId: 'https://remote.test/users/hidden-runner'
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityId: 'https://remote.test/users/public-runner/statuses/1'
        }),
        expect.objectContaining({
          entityId: 'https://remote.test/users/hidden-runner/statuses/1'
        })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('generates PostgreSQL and MySQL full-text index DDL', async () => {
    const migration =
      await import('@/migrations/20260523000000_add_search_documents.js')

    const pgRaw = jest.fn().mockResolvedValue(undefined)
    const pgSchema = {
      createTable: jest.fn().mockResolvedValue(undefined)
    }
    await migration.up({
      client: { config: { client: 'pg' } },
      schema: pgSchema,
      raw: pgRaw,
      fn: { now: jest.fn() }
    })
    expect(pgRaw).toHaveBeenCalledWith(expect.stringContaining('USING GIN'))

    const mysqlRaw = jest.fn().mockResolvedValue(undefined)
    const mysqlSchema = {
      createTable: jest.fn().mockResolvedValue(undefined)
    }
    await migration.up({
      client: { config: { client: 'mysql2' } },
      schema: mysqlSchema,
      raw: mysqlRaw,
      fn: { now: jest.fn() }
    })
    expect(mysqlRaw).toHaveBeenCalledWith(
      expect.stringContaining('FULLTEXT INDEX')
    )
  })
})
