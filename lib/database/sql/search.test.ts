import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getSearchTokens } from '@/lib/database/sql/search'
import {
  applySearchDocumentFilter,
  applySearchDocumentOrdering
} from '@/lib/database/sql/search/documents'
import { FollowStatus } from '@/lib/types/domain/follow'

describe('SearchDatabase foundation', () => {
  const createTableMock = () => {
    const column = {
      defaultTo: jest.fn(() => column),
      notNullable: jest.fn(() => column),
      nullable: jest.fn(() => column),
      primary: jest.fn(() => column)
    }
    return {
      boolean: jest.fn(() => column),
      charset: jest.fn(),
      collate: jest.fn(),
      index: jest.fn(),
      integer: jest.fn(() => column),
      string: jest.fn(() => column),
      text: jest.fn(() => column),
      timestamp: jest.fn(() => column),
      unique: jest.fn()
    }
  }

  it('tokenizes Unicode search text', () => {
    expect(getSearchTokens('  Café 東京 runner_1  ')).toEqual([
      'café',
      '東京',
      'runner_1'
    ])
  })

  it('fails loudly for per-entity search methods that are not implemented yet', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)

    try {
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).rejects.toThrow('not implemented: searchAccountIds')
      await expect(
        database.indexActorSearchDocument({
          id: 'https://remote.test/users/alice'
        })
      ).rejects.toThrow('not implemented: indexActorSearchDocument')
      await expect(database.reindexSearchAccounts()).rejects.toThrow(
        'not implemented: reindexSearchAccounts'
      )
      await expect(
        database.searchHashtags({ q: 'runner', limit: 10 })
      ).rejects.toThrow('not implemented: searchHashtags')
      await expect(
        database.indexHashtagSearchDocument({ hashtag: 'runner' })
      ).rejects.toThrow('not implemented: indexHashtagSearchDocument')
      await expect(database.reindexSearchHashtags()).rejects.toThrow(
        'not implemented: reindexSearchHashtags'
      )
      await expect(
        database.searchStatusIds({
          q: 'runner',
          limit: 10,
          currentActorId: 'https://remote.test/users/alice'
        })
      ).rejects.toThrow('not implemented: searchStatusIds')
      await expect(
        database.indexStatusSearchDocument({ statusId: 'status-1' })
      ).rejects.toThrow('not implemented: indexStatusSearchDocument')
      await expect(database.reindexSearchStatuses()).rejects.toThrow(
        'not implemented: reindexSearchStatuses'
      )
    } finally {
      await database.destroy()
    }
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

  it('preserves zero-valued search document timestamps', async () => {
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
        entityType: 'hashtag',
        entityId: 'epoch',
        documentText: 'epoch runner',
        entityCreatedAt: 0,
        lastPostAt: 0
      })

      await expect(
        database.searchDocuments({
          entityType: 'hashtag',
          q: 'runner',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          entityCreatedAt: 0,
          lastPostAt: 0
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
        entityId: 'https://remote.test/users/unlisted-runner/statuses/1',
        documentText: 'runner unlisted status',
        actorId: 'https://remote.test/users/unlisted-runner',
        visibility: 'unlisted'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/hidden-runner/statuses/1',
        documentText: 'runner private status',
        actorId: 'https://remote.test/users/hidden-runner',
        visibility: 'private'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/direct-runner/statuses/1',
        documentText: 'runner direct status',
        actorId: 'https://remote.test/users/direct-runner',
        visibility: 'direct'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/followed-runner/statuses/1',
        documentText: 'runner followed private status',
        actorId: 'https://remote.test/users/followed-runner',
        visibility: 'private'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/unfollowed-runner/statuses/1',
        documentText: 'runner unfollowed private status',
        actorId: 'https://remote.test/users/unfollowed-runner',
        visibility: 'private'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/missing-runner/statuses/1',
        documentText: 'runner missing actor private status',
        actorId: 'https://remote.test/users/missing-runner',
        visibility: 'private'
      })
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/forged-runner/statuses/1',
        documentText: 'runner forged private status',
        actorId: 'https://remote.test/users/forged-runner',
        visibility: 'private'
      })
      await knexDatabase('actors').insert({
        id: 'https://remote.test/users/followed-runner',
        type: 'Person',
        username: 'followed-runner',
        domain: 'remote.test',
        name: null,
        summary: null,
        accountId: null,
        settings: JSON.stringify({
          followersUrl: 'https://remote.test/users/followed-runner/followers',
          inboxUrl: 'https://remote.test/users/followed-runner/inbox',
          sharedInboxUrl: 'https://remote.test/inbox'
        }),
        publicKey: 'public-key',
        privateKey: null,
        deletionStatus: null,
        deletionScheduledAt: null,
        createdAt: new Date(1),
        updatedAt: new Date(1)
      })
      await knexDatabase('recipients').insert([
        {
          id: 'search-direct-recipient',
          statusId: 'https://remote.test/users/direct-runner/statuses/1',
          actorId: 'https://remote.test/users/current-runner',
          type: 'to'
        },
        {
          id: 'search-followed-recipient',
          statusId: 'https://remote.test/users/followed-runner/statuses/1',
          actorId: 'https://remote.test/users/followed-runner/followers',
          type: 'to'
        },
        {
          id: 'search-unfollowed-recipient',
          statusId: 'https://remote.test/users/unfollowed-runner/statuses/1',
          actorId: 'https://remote.test/users/unfollowed-runner/followers',
          type: 'to'
        },
        {
          id: 'search-missing-actor-recipient',
          statusId: 'https://remote.test/users/missing-runner/statuses/1',
          actorId: 'https://remote.test/users/missing-runner/followers',
          type: 'to'
        },
        {
          id: 'search-forged-recipient',
          statusId: 'https://remote.test/users/forged-runner/statuses/1',
          actorId: 'https://remote.test/users/followed-runner/followers',
          type: 'to'
        }
      ])
      await knexDatabase('follows').insert([
        {
          id: 'search-followed-runner-follow',
          actorId: 'https://remote.test/users/current-runner',
          actorHost: 'remote.test',
          targetActorId: 'https://remote.test/users/followed-runner',
          targetActorHost: 'remote.test',
          status: FollowStatus.enum.Accepted
        },
        {
          id: 'search-missing-runner-follow',
          actorId: 'https://remote.test/users/current-runner',
          actorHost: 'remote.test',
          targetActorId: 'https://remote.test/users/missing-runner',
          targetActorHost: 'remote.test',
          status: FollowStatus.enum.Accepted
        }
      ])

      const anonymousResults = await database.searchDocuments({
        q: 'runner',
        limit: 20,
        offset: 0
      })
      expect(anonymousResults.map((result) => result.entityId)).toEqual(
        expect.arrayContaining([
          'https://remote.test/users/public-runner',
          'https://remote.test/users/public-runner/statuses/1',
          'https://remote.test/users/unlisted-runner/statuses/1'
        ])
      )
      expect(anonymousResults.map((result) => result.entityId)).not.toContain(
        'https://remote.test/users/hidden-runner/statuses/1'
      )
      expect(anonymousResults.map((result) => result.entityId)).not.toContain(
        'https://remote.test/users/direct-runner/statuses/1'
      )
      expect(anonymousResults.map((result) => result.entityId)).not.toContain(
        'https://remote.test/users/followed-runner/statuses/1'
      )
      expect(anonymousResults.map((result) => result.entityId)).not.toContain(
        'https://remote.test/users/unfollowed-runner/statuses/1'
      )

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

      const hiddenRunnerResults = await database.searchDocuments({
        entityType: 'status',
        q: 'runner',
        limit: 10,
        visibleToActorId: 'https://remote.test/users/hidden-runner'
      })
      expect(hiddenRunnerResults.map((result) => result.entityId)).toEqual(
        expect.arrayContaining([
          'https://remote.test/users/public-runner/statuses/1',
          'https://remote.test/users/unlisted-runner/statuses/1',
          'https://remote.test/users/hidden-runner/statuses/1'
        ])
      )

      const currentRunnerResults = await database.searchDocuments({
        entityType: 'status',
        q: 'runner',
        limit: 20,
        visibleToActorId: 'https://remote.test/users/current-runner'
      })
      expect(currentRunnerResults.map((result) => result.entityId)).toEqual(
        expect.arrayContaining([
          'https://remote.test/users/public-runner/statuses/1',
          'https://remote.test/users/unlisted-runner/statuses/1',
          'https://remote.test/users/direct-runner/statuses/1',
          'https://remote.test/users/followed-runner/statuses/1',
          'https://remote.test/users/missing-runner/statuses/1'
        ])
      )
      expect(
        currentRunnerResults.map((result) => result.entityId)
      ).not.toContain('https://remote.test/users/hidden-runner/statuses/1')
      expect(
        currentRunnerResults.map((result) => result.entityId)
      ).not.toContain('https://remote.test/users/unfollowed-runner/statuses/1')
      expect(
        currentRunnerResults.map((result) => result.entityId)
      ).not.toContain('https://remote.test/users/forged-runner/statuses/1')
    } finally {
      await database.destroy()
    }
  })

  it('uses the MySQL LIKE fallback for tokens below the active full-text minimum', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const raw = jest.fn().mockResolvedValue([
      [
        {
          innodbFtMinTokenSize: 4,
          ftMinWordLen: 4
        }
      ]
    ])
    const mysqlConfigDatabase = {
      client: mysqlDatabase.client,
      raw
    } as unknown as typeof mysqlDatabase

    try {
      const query = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query,
        q: 'al runner'
      })

      const sql = query.toSQL()
      expect(sql.sql).toContain('LOWER(`search_documents`.`documentText`) LIKE')
      expect(sql.bindings).toEqual(['%al%', '%runner%'])
      expect(raw).toHaveBeenCalledWith(
        'select @@innodb_ft_min_token_size as innodbFtMinTokenSize, @@ft_min_word_len as ftMinWordLen'
      )
    } finally {
      await mysqlDatabase.destroy()
    }
  })

  it('retries MySQL full-text minimum lookup after a transient failure', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const raw = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary variables unavailable'))
      .mockResolvedValueOnce([
        [
          {
            innodbFtMinTokenSize: 3,
            ftMinWordLen: 4
          }
        ]
      ])
    const mysqlConfigDatabase = {
      client: mysqlDatabase.client,
      raw
    } as unknown as typeof mysqlDatabase

    try {
      const fallbackQuery = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query: fallbackQuery,
        q: 'run'
      })
      expect(fallbackQuery.toSQL().sql).toContain(
        'LOWER(`search_documents`.`documentText`) LIKE'
      )

      const retryQuery = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query: retryQuery,
        q: 'run'
      })
      expect(raw).toHaveBeenCalledTimes(2)
      expect(retryQuery.toSQL().sql).toContain(
        'MATCH(`search_documents`.`documentText`)'
      )
    } finally {
      await mysqlDatabase.destroy()
    }
  })

  it('only applies entityId ranking boosts to hashtag searches', async () => {
    const postgresDatabase = knex({ client: 'pg' })

    try {
      const query = postgresDatabase('search_documents').select('*')
      applySearchDocumentOrdering({
        query,
        q: 'runner'
      })

      const sql = query.toSQL()
      expect(sql.sql).not.toContain('documentText')
      expect(sql.sql).not.toContain('lower("search_documents"."entityId")')
      expect(sql.sql).toContain('"search_documents"."postCount" is null')
      expect(sql.sql).toContain('"search_documents"."lastPostAt" is null')
      expect(sql.sql).toContain('"search_documents"."entityCreatedAt" is null')
      expect(sql.bindings).toEqual([])

      const hashtagQuery = postgresDatabase('search_documents').select('*')
      applySearchDocumentOrdering({
        query: hashtagQuery,
        q: '#runner',
        entityType: 'hashtag'
      })
      const hashtagSql = hashtagQuery.toSQL()
      expect(hashtagSql.sql).toContain('lower("search_documents"."entityId")')
      expect(hashtagSql.bindings).toEqual(['runner', 'runner%'])
    } finally {
      await postgresDatabase.destroy()
    }
  })

  it('skips one-character MySQL LIKE fallback tokens', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const raw = jest.fn().mockResolvedValue([
      [
        {
          innodbFtMinTokenSize: 4,
          ftMinWordLen: 4
        }
      ]
    ])
    const mysqlConfigDatabase = {
      client: mysqlDatabase.client,
      raw
    } as unknown as typeof mysqlDatabase

    try {
      const query = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query,
        q: 'a runner'
      })

      const sql = query.toSQL()
      expect(sql.sql).toContain('LOWER(`search_documents`.`documentText`) LIKE')
      expect(sql.bindings).toEqual(['%runner%'])

      const oneCharacterQuery = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query: oneCharacterQuery,
        q: 'a'
      })
      expect(oneCharacterQuery.toSQL().sql).toContain('1 = 0')
    } finally {
      await mysqlDatabase.destroy()
    }
  })

  it('uses the InnoDB MySQL full-text minimum when it differs from MyISAM', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const raw = jest.fn().mockResolvedValue([
      [
        {
          innodbFtMinTokenSize: 3,
          ftMinWordLen: 4
        }
      ]
    ])
    const mysqlConfigDatabase = {
      client: mysqlDatabase.client,
      raw
    } as unknown as typeof mysqlDatabase

    try {
      const query = mysqlDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: mysqlConfigDatabase,
        query,
        q: 'run trail'
      })

      const sql = query.toSQL()
      expect(sql.sql).toContain('MATCH(`search_documents`.`documentText`)')
      expect(sql.sql).not.toContain(
        'LOWER(`search_documents`.`documentText`) LIKE'
      )
      expect(sql.bindings).toEqual(['+run* +trail*'])
    } finally {
      await mysqlDatabase.destroy()
    }
  })

  it('matches the PostgreSQL full-text query expression to the index', async () => {
    const postgresDatabase = knex({ client: 'pg' })

    try {
      const query = postgresDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: postgresDatabase,
        query,
        q: 'trail'
      })

      const sql = query.toSQL()
      expect(sql.sql).toContain(`to_tsvector('simple', "documentText")`)
      expect(sql.sql).not.toContain(
        `to_tsvector('simple', "search_documents"."documentText")`
      )
    } finally {
      await postgresDatabase.destroy()
    }
  })

  it('generates portable PostgreSQL and MySQL search table DDL', async () => {
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
    expect(pgRaw).toHaveBeenCalledWith(
      `CREATE INDEX search_documents_document_text_fts ON search_documents USING GIN (to_tsvector('simple', "documentText"))`
    )

    const mysqlRaw = jest.fn().mockResolvedValue(undefined)
    const mysqlTable = createTableMock()
    const mysqlSchema = {
      createTable: jest.fn(async (_tableName, callback) => {
        callback(mysqlTable)
      })
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
    expect(mysqlTable.charset).toHaveBeenCalledWith('utf8mb4')
    expect(mysqlTable.collate).toHaveBeenCalledWith('utf8mb4_unicode_ci')
    expect(mysqlTable.unique).not.toHaveBeenCalled()
  })

  it('matches database clients by exact supported names', async () => {
    const migration =
      await import('@/migrations/20260523000000_add_search_documents.js')

    const raw = jest.fn().mockResolvedValue(undefined)
    const schema = {
      createTable: jest.fn().mockResolvedValue(undefined)
    }
    await migration.up({
      client: { config: { client: 'pgcluster' } },
      schema,
      raw,
      fn: { now: jest.fn() }
    })
    expect(raw).not.toHaveBeenCalled()
  })
})
