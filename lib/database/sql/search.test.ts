import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { getSearchTokens } from '@/lib/database/sql/search'
import {
  applySearchDocumentFilter,
  applySearchDocumentOrdering
} from '@/lib/database/sql/search/documents'
import { FollowStatus } from '@/lib/types/domain/follow'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'
import { getLocalActorId } from '@/lib/utils/activitypubId'

const createSearchActor = async (
  database: ReturnType<typeof getSQLDatabase>,
  {
    id,
    username,
    domain = 'remote.test',
    name,
    summary
  }: {
    id: string
    username: string
    domain?: string
    name?: string
    summary?: string
  }
) => {
  await database.createActor({
    actorId: id,
    username,
    domain,
    name,
    summary,
    inboxUrl: `${id}/inbox`,
    sharedInboxUrl: `https://${domain}/inbox`,
    followersUrl: `${id}/followers`,
    publicKey: 'public-key',
    privateKey: 'private-key',
    createdAt: 1
  })
}

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
      await database.upsertSearchDocument({
        entityType: 'status',
        entityId: 'https://remote.test/users/self-forged-runner/statuses/1',
        documentText: 'runner self forged private status',
        actorId: 'https://remote.test/users/self-forged-runner',
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
      await knexDatabase('actors').insert({
        id: 'https://remote.test/users/self-forged-runner',
        type: 'Person',
        username: 'self-forged-runner',
        domain: 'remote.test',
        name: null,
        summary: null,
        accountId: null,
        settings: JSON.stringify({
          followersUrl: 'https://remote.test/users/followed-runner/followers',
          inboxUrl: 'https://remote.test/users/self-forged-runner/inbox',
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
        },
        {
          id: 'search-self-forged-recipient',
          statusId: 'https://remote.test/users/self-forged-runner/statuses/1',
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
        },
        {
          id: 'search-self-forged-runner-follow',
          actorId: 'https://remote.test/users/current-runner',
          actorHost: 'remote.test',
          targetActorId: 'https://remote.test/users/self-forged-runner',
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
          'https://remote.test/users/missing-runner/statuses/1',
          'https://remote.test/users/self-forged-runner/statuses/1'
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

  it('cools down repeated MySQL full-text minimum lookup failures', async () => {
    const mysqlDatabase = knex({ client: 'mysql2' })
    const raw = jest.fn().mockRejectedValue(new Error('variables unavailable'))
    const mysqlConfigDatabase = {
      client: mysqlDatabase.client,
      raw
    } as unknown as typeof mysqlDatabase

    try {
      for (const q of ['run', 'jog', 'row']) {
        const query = mysqlDatabase('search_documents').select('*')
        await applySearchDocumentFilter({
          database: mysqlConfigDatabase,
          query,
          q
        })
        expect(query.toSQL().sql).toContain(
          'LOWER(`search_documents`.`documentText`) LIKE'
        )
      }

      expect(raw).toHaveBeenCalledTimes(2)
    } finally {
      await mysqlDatabase.destroy()
    }
  })

  it('only applies entityId ranking boosts to hashtag searches', async () => {
    const postgresDatabase = knex({ client: 'pg' })
    const sqliteDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })

    try {
      const query = postgresDatabase('search_documents').select('*')
      applySearchDocumentOrdering({
        database: postgresDatabase,
        query,
        q: 'runner'
      })

      const sql = query.toSQL()
      expect(sql.sql).not.toContain('documentText')
      expect(sql.sql).not.toContain('lower("search_documents"."entityId")')
      expect(sql.sql).toContain(
        '"search_documents"."postCount" desc nulls last'
      )
      expect(sql.sql).toContain(
        '"search_documents"."lastPostAt" desc nulls last'
      )
      expect(sql.sql).toContain(
        '"search_documents"."entityCreatedAt" desc nulls last'
      )
      expect(sql.sql).not.toContain('"search_documents"."postCount" is null')
      expect(sql.bindings).toEqual([])

      const hashtagQuery = postgresDatabase('search_documents').select('*')
      applySearchDocumentOrdering({
        database: postgresDatabase,
        query: hashtagQuery,
        q: '#runner',
        entityType: 'hashtag'
      })
      const hashtagSql = hashtagQuery.toSQL()
      expect(hashtagSql.sql).toContain('lower("search_documents"."entityId")')
      expect(hashtagSql.bindings).toEqual(['runner', 'runner%'])

      const sqliteQuery = sqliteDatabase('search_documents').select('*')
      applySearchDocumentOrdering({
        database: sqliteDatabase,
        query: sqliteQuery,
        q: 'runner'
      })
      const sqliteSql = sqliteQuery.toSQL()
      expect(sqliteSql.sql).toContain('`search_documents`.`postCount` is null')
      expect(sqliteSql.sql).toContain('`search_documents`.`lastPostAt` is null')
      expect(sqliteSql.sql).toContain(
        '`search_documents`.`entityCreatedAt` is null'
      )
    } finally {
      await postgresDatabase.destroy()
      await sqliteDatabase.destroy()
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

  it('indexes actors and searches accounts by profile text', async () => {
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
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        name: 'Alice Runner',
        summary: 'Trail running logs'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        name: 'Bob Builder'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10,
          offset: 0
        })
      ).resolves.toEqual(['https://remote.test/users/alice'])
    } finally {
      await database.destroy()
    }
  })

  it('filters account search to followed actors when requested', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const aliceId = 'https://remote.test/users/alice'
    const bobId = 'https://remote.test/users/bob'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: 'https://remote.test/users/viewer',
        username: 'viewer'
      })
      await createSearchActor(database, {
        id: aliceId,
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: bobId,
        username: 'bob',
        summary: 'Runner'
      })
      await knexDatabase('actors')
        .where('id', bobId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${bobId}/followers`,
            inboxUrl: `${bobId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
      await database.indexActorSearchDocument({ id: bobId })
      await database.createFollow({
        actorId: 'https://remote.test/users/viewer',
        targetActorId: bobId,
        status: FollowStatus.enum.Accepted,
        inbox: 'https://remote.test/users/bob/inbox',
        sharedInbox: 'https://remote.test/inbox'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10
        })
      ).resolves.toEqual([aliceId])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 10,
          followingActorId: 'https://remote.test/users/viewer'
        })
      ).resolves.toEqual([bobId])
    } finally {
      await database.destroy()
    }
  })

  it('only returns non-discoverable accounts for exact handle matches', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/secret'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'secret',
        summary: 'Hidden account'
      })
      await knexDatabase('actors')
        .where('id', actorId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
      await database.indexActorSearchDocument({ id: actorId })

      await expect(
        database.searchAccountIds({
          q: 'hidden',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10,
          localDomain: 'remote.test'
        })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
      await knexDatabase('actors')
        .where('id', actorId)
        .update({ username: 'Secret' })
      await database.indexActorSearchDocument({ id: actorId })
      await expect(
        database.searchAccountIds({
          q: 'secret',
          limit: 10,
          localDomain: 'remote.test'
        })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
      await database.deleteActorSearchDocument({ id: actorId })
      await expect(
        database.searchAccountIds({
          q: '@secret@remote.test',
          limit: 10
        })
      ).resolves.toEqual([actorId])
    } finally {
      await database.destroy()
    }
  })

  it('escapes account ordering prefix wildcards', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const alphaId = 'https://remote.test/users/alpha'
    const xunnerId = 'https://remote.test/users/xunner'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: xunnerId,
        username: 'xunner',
        summary: '_unner literal token'
      })
      await createSearchActor(database, {
        id: alphaId,
        username: 'alpha',
        summary: '_unner literal token'
      })

      await expect(
        database.searchAccountIds({
          q: '_unner',
          limit: 10
        })
      ).resolves.toEqual([alphaId, xunnerId])
    } finally {
      await database.destroy()
    }
  })

  it('indexes local account creation without reloading the inserted actor', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      knexDatabase.on('query', handleQuery)
      await database.createAccount({
        email: 'local-runner@remote.test',
        username: 'local-runner',
        passwordHash: 'password-hash',
        domain: 'remote.test',
        privateKey: 'private-key',
        publicKey: 'public-key'
      })
      knexDatabase.off('query', handleQuery)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'local-runner', limit: 10 })
      ).resolves.toEqual([
        getLocalActorId({ domain: 'remote.test', username: 'local-runner' })
      ])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('indexes account actors without reloading the inserted actor', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      const accountId = await database.createAccount({
        email: 'local-runner@remote.test',
        username: 'local-runner',
        passwordHash: 'password-hash',
        domain: 'remote.test',
        privateKey: 'private-key',
        publicKey: 'public-key'
      })

      knexDatabase.on('query', handleQuery)
      const actorId = await database.createActorForAccount({
        accountId,
        username: 'secondary-runner',
        domain: 'remote.test',
        privateKey: 'secondary-private-key',
        publicKey: 'secondary-public-key'
      })
      knexDatabase.off('query', handleQuery)

      expect(actorSelectQueries).toHaveLength(0)
      await expect(
        database.searchAccountIds({ q: 'secondary-runner', limit: 10 })
      ).resolves.toEqual([actorId])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('paginates exact account matches with indexed results without skipping', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const exactActorId = 'https://remote.test/users/runner'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: exactActorId,
        username: 'runner',
        summary: 'Hidden runner'
      })
      await knexDatabase('actors')
        .where('id', exactActorId)
        .update({
          settings: JSON.stringify({
            followersUrl: `${exactActorId}/followers`,
            inboxUrl: `${exactActorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox',
            noindex: true
          })
        })
      await database.indexActorSearchDocument({ id: exactActorId })
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 0,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual([exactActorId, 'https://remote.test/users/alice'])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 2,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual(['https://remote.test/users/bob'])
    } finally {
      await database.destroy()
    }
  })

  it('returns exact account matches without existing search documents', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const exactActorId = 'https://remote.test/users/legacy-runner'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: exactActorId,
        username: 'legacy-runner',
        summary: 'Legacy runner'
      })
      await database.deleteActorSearchDocument({ id: exactActorId })
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 0,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual([exactActorId, 'https://remote.test/users/alice'])
      await expect(
        database.searchAccountIds({
          q: 'runner',
          limit: 2,
          offset: 2,
          exactActorIds: [exactActorId]
        })
      ).resolves.toEqual(['https://remote.test/users/bob'])
    } finally {
      await database.destroy()
    }
  })

  it('updates account search discoverability during deletion transitions', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/deleting-runner'
    const viewerId = 'https://remote.test/users/deletion-viewer'

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: viewerId,
        username: 'deletion-viewer'
      })
      await createSearchActor(database, {
        id: actorId,
        username: 'deleting-runner',
        summary: 'Runner'
      })
      await database.createFollow({
        actorId: viewerId,
        targetActorId: actorId,
        status: FollowStatus.enum.Accepted,
        inbox: `${actorId}/inbox`,
        sharedInbox: 'https://remote.test/inbox'
      })

      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10,
          followingActorId: viewerId
        })
      ).resolves.toEqual([actorId])
      await database.scheduleActorDeletion({
        actorId,
        scheduledAt: new Date()
      })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10
        })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@deleting-runner@remote.test',
          limit: 10,
          followingActorId: viewerId
        })
      ).resolves.toEqual([])
      await database.cancelActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
      await database.startActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([])
      await database.cancelActorDeletion({ actorId })
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([actorId])
    } finally {
      await database.destroy()
    }
  })

  it('reindexes account search documents with a batched upsert', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const insertQueries: string[] = []
    const actorSelectQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.includes('insert into `search_documents`') ||
        sql.includes('insert into "search_documents"')
      ) {
        insertQueries.push(sql)
      }
      if (
        sql.toLowerCase().startsWith('select') &&
        (sql.includes('from `actors`') || sql.includes('from "actors"'))
      ) {
        actorSelectQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: 'https://remote.test/users/alice',
        username: 'alice',
        summary: 'Runner'
      })
      await createSearchActor(database, {
        id: 'https://remote.test/users/bob',
        username: 'bob',
        summary: 'Runner'
      })

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchAccounts({ limit: 10 })
      knexDatabase.off('query', handleQuery)

      expect(insertQueries).toHaveLength(1)
      expect(actorSelectQueries).toHaveLength(1)
      expect(actorSelectQueries[0]).not.toContain('select *')
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 10 })
      ).resolves.toEqual([
        'https://remote.test/users/alice',
        'https://remote.test/users/bob'
      ])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('sizes SQLite account reindex batches from the search document column count', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const insertQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.includes('insert into `search_documents`') ||
        sql.includes('insert into "search_documents"')
      ) {
        insertQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      for (let index = 0; index < 83; index += 1) {
        const actorId = `https://remote.test/users/batch-runner-${index}`
        await knexDatabase('actors').insert({
          id: actorId,
          type: 'Person',
          username: `batch-runner-${index}`,
          domain: 'remote.test',
          name: null,
          summary: 'Runner',
          accountId: null,
          settings: JSON.stringify({
            followersUrl: `${actorId}/followers`,
            inboxUrl: `${actorId}/inbox`,
            sharedInboxUrl: 'https://remote.test/inbox'
          }),
          publicKey: 'public-key',
          privateKey: null,
          deletionStatus: null,
          deletionScheduledAt: null,
          createdAt: new Date(1),
          updatedAt: new Date(1)
        })
      }

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchAccounts({ limit: 83 })
      knexDatabase.off('query', handleQuery)

      expect(insertQueries).toHaveLength(1)
      await expect(
        database.searchAccountIds({ q: 'runner', limit: 100 })
      ).resolves.toHaveLength(83)
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('excludes internal federation signing actors from account search', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/__instance__'

    try {
      await database.migrate()
      await database.createActor({
        actorId,
        type: 'Service',
        username: '__instance__',
        domain: 'remote.test',
        name: 'Instance actor',
        summary: 'Service actor used for ActivityPub federation signing.',
        inboxUrl: `${actorId}/inbox`,
        sharedInboxUrl: 'https://remote.test/inbox',
        followersUrl: `${actorId}/followers`,
        publicKey: 'public-key',
        privateKey: 'private-key',
        createdAt: 1
      })

      await expect(
        database.searchAccountIds({ q: 'instance', limit: 10 })
      ).resolves.toEqual([])
      await expect(
        database.searchAccountIds({
          q: '@__instance__@remote.test',
          limit: 10,
          exactActorIds: [actorId]
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('indexes public hashtags and returns Mastodon tag-shaped results', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/hashtag-search`

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC_COMPACT],
        cc: [],
        text: 'Trail day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Running',
        value: 'https://remote.test/tags/running'
      })

      await expect(
        database.searchHashtags({
          q: 'run',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'running',
          history: [],
          following: false,
          postCount: 1,
          lastPostAt: 1
        })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('rebuilds and removes hashtag search aggregates as statuses change', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/reindex-hashtag`

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Trail day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Cycling',
        value: 'https://remote.test/tags/cycling'
      })
      await database.deleteHashtagSearchDocument({ hashtag: 'cycling' })

      await expect(
        database.reindexSearchHashtags({
          limit: 10
        })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        database.searchHashtags({
          q: 'cycling',
          limit: 10
        })
      ).resolves.toHaveLength(1)

      await database.deleteStatus({ statusId })

      await expect(
        database.searchHashtags({
          q: 'cycling',
          limit: 10
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('rebuilds hashtag search aggregates from legacy bare normalized tag names', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/legacy-hashtag`

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Legacy hashtag day',
        createdAt: 1
      })
      await knexDatabase('tags').insert({
        id: crypto.randomUUID(),
        statusId,
        type: 'hashtag',
        name: '#Legacy',
        value: 'https://remote.test/tags/legacy',
        nameNormalized: 'legacy',
        createdAt: new Date(),
        updatedAt: new Date()
      })

      await expect(
        database.reindexSearchHashtags({
          limit: 10
        })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        database.searchHashtags({
          q: 'legacy',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'legacy',
          postCount: 1
        })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('refreshes hashtag search aggregates after visibility changes', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/visibility-hashtag`

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [],
        cc: [],
        text: 'Private hashtag day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Visibility',
        value: 'https://remote.test/tags/visibility'
      })

      await expect(
        database.searchHashtags({
          q: 'visibility',
          limit: 10
        })
      ).resolves.toEqual([])

      await database.updateNoteVisibility({
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      await expect(
        database.searchHashtags({
          q: 'visibility',
          limit: 10
        })
      ).resolves.toHaveLength(1)

      await database.updateNoteVisibility({
        statusId,
        to: [],
        cc: []
      })
      await expect(
        database.searchHashtags({
          q: 'visibility',
          limit: 10
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('refreshes hashtag search aggregates when deleting actor data', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/actor-delete-hashtag`

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Actor deletion hashtag day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Cleanup',
        value: 'https://remote.test/tags/cleanup'
      })

      await expect(
        database.searchHashtags({
          q: 'cleanup',
          limit: 10
        })
      ).resolves.toHaveLength(1)

      await database.deleteActorData({ actorId })

      await expect(
        database.searchHashtags({
          q: 'cleanup',
          limit: 10
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })
})
