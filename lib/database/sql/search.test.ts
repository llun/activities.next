import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getSearchTokens } from '@/lib/database/sql/search'
import { applySearchDocumentFilter } from '@/lib/database/sql/search/documents'
import { FollowStatus } from '@/lib/types/domain/follow'

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
      await database.createActor({
        actorId: 'https://remote.test/users/followed-runner',
        username: 'followed-runner',
        domain: 'remote.test',
        followersUrl: 'https://remote.test/users/followed-runner/followers',
        inboxUrl: 'https://remote.test/users/followed-runner/inbox',
        sharedInboxUrl: 'https://remote.test/inbox',
        publicKey: 'public-key',
        createdAt: 1
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
        }
      ])
      await knexDatabase('follows').insert({
        id: 'search-followed-runner-follow',
        actorId: 'https://remote.test/users/current-runner',
        actorHost: 'remote.test',
        targetActorId: 'https://remote.test/users/followed-runner',
        targetActorHost: 'remote.test',
        status: FollowStatus.enum.Accepted
      })

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
          'https://remote.test/users/followed-runner/statuses/1'
        ])
      )
      expect(
        currentRunnerResults.map((result) => result.entityId)
      ).not.toContain('https://remote.test/users/hidden-runner/statuses/1')
      expect(
        currentRunnerResults.map((result) => result.entityId)
      ).not.toContain('https://remote.test/users/unfollowed-runner/statuses/1')
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

  it('qualifies the PostgreSQL full-text document column', async () => {
    const postgresDatabase = knex({ client: 'pg' })

    try {
      const query = postgresDatabase('search_documents').select('*')
      await applySearchDocumentFilter({
        database: postgresDatabase,
        query,
        q: 'trail'
      })

      const sql = query.toSQL()
      expect(sql.sql).toContain(
        `to_tsvector('simple', "search_documents"."documentText")`
      )
    } finally {
      await postgresDatabase.destroy()
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
