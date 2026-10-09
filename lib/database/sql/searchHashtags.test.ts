import knex from 'knex'

import { getSQLDatabase } from '@/lib/database/sql'
import { createSearchActor } from '@/lib/database/sql/searchTestHelpers'
import { StatusType } from '@/lib/types/domain/status'
import {
  ACTIVITY_STREAM_PUBLIC,
  ACTIVITY_STREAM_PUBLIC_COMPACT
} from '@/lib/utils/activitystream'

describe('SearchDatabase hashtags', () => {
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
    const queries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      queries.push(sql.toLowerCase())
    }

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
      knexDatabase.on('query', handleQuery)
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Running',
        value: 'https://remote.test/tags/running'
      })
      knexDatabase.off('query', handleQuery)

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
      const aggregateSql =
        queries.find((sql) => sql.includes('as `hashtag_statuses`')) ?? ''
      expect(aggregateSql).not.toContain('inner join `recipients`')
      expect(aggregateSql).toContain(
        '`recipients`.`statusid` = `statuses`.`id`'
      )
      expect(aggregateSql).toContain('`recipients`.`actorid` in')
      expect(aggregateSql).not.toContain('`statuses`.`id` in (select')
      expect(aggregateSql).toContain('exists')
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('preserves zero-valued hashtag aggregate timestamps', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/epoch-hashtag`
    const createdAt = new Date(0)

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await knexDatabase('statuses').insert({
        id: statusId,
        url: statusId,
        urlHash: null,
        actorId,
        type: StatusType.enum.Note,
        content: JSON.stringify({
          url: statusId,
          text: 'Epoch hashtag day',
          summary: ''
        }),
        reply: '',
        replyHash: null,
        createdAt,
        updatedAt: createdAt
      })
      await knexDatabase('recipients').insert({
        id: crypto.randomUUID(),
        statusId,
        actorId: ACTIVITY_STREAM_PUBLIC,
        type: 'to',
        createdAt,
        updatedAt: createdAt
      })
      await knexDatabase('tags').insert({
        id: crypto.randomUUID(),
        statusId,
        type: 'hashtag',
        name: '#Epoch',
        value: 'https://remote.test/tags/epoch',
        nameNormalized: '#epoch',
        createdAt,
        updatedAt: createdAt
      })

      await database.indexHashtagSearchDocuments({
        hashtags: ['epoch']
      })

      await expect(
        database.searchHashtags({
          q: 'epoch',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'epoch',
          postCount: 1,
          lastPostAt: 0
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

  it('removes stale hashtag search documents during full reindex', async () => {
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
        entityId: 'orphaned',
        documentText: 'orphaned #orphaned',
        postCount: 3,
        lastPostAt: 1
      })

      await expect(
        database.searchHashtags({
          q: 'orphaned',
          limit: 10
        })
      ).resolves.toHaveLength(1)

      await expect(
        database.reindexSearchHashtags({
          limit: 10
        })
      ).resolves.toEqual({ indexed: 0, nextCursor: null })

      await expect(
        database.searchHashtags({
          q: 'orphaned',
          limit: 10
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('limits stale hashtag search cleanup to a full reindex start', async () => {
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
        entityId: 'orphaned-cursor',
        documentText: 'orphaned cursor #orphaned-cursor',
        postCount: 3,
        lastPostAt: 1
      })

      await database.reindexSearchHashtags({
        afterId: '#already-scanned',
        limit: 10
      })

      await expect(
        database.searchHashtags({
          q: 'orphaned-cursor',
          limit: 10
        })
      ).resolves.toHaveLength(1)

      await database.reindexSearchHashtags({
        limit: 10
      })

      await expect(
        database.searchHashtags({
          q: 'orphaned-cursor',
          limit: 10
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('reports reindex progress using the raw scanned row count', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/duplicate-normalized-hashtag`
    const createdAt = new Date(1)

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await knexDatabase('statuses').insert({
        id: statusId,
        url: statusId,
        urlHash: null,
        actorId,
        type: StatusType.enum.Note,
        content: JSON.stringify({ text: 'Duplicate normalized hashtag' }),
        reply: '',
        replyHash: null,
        originalStatusId: null,
        createdAt,
        updatedAt: createdAt
      })
      await knexDatabase('recipients').insert({
        id: 'duplicate-normalized-hashtag-recipient',
        statusId,
        actorId: ACTIVITY_STREAM_PUBLIC,
        type: 'to',
        createdAt,
        updatedAt: createdAt
      })
      await knexDatabase('tags').insert([
        {
          id: 'duplicate-normalized-hashtag-tag-1',
          statusId,
          type: 'hashtag',
          name: '#Duplicate',
          value: 'https://remote.test/tags/duplicate',
          nameNormalized: '#duplicate',
          createdAt,
          updatedAt: createdAt
        },
        {
          id: 'duplicate-normalized-hashtag-tag-2',
          statusId,
          type: 'hashtag',
          name: 'Duplicate',
          value: 'https://remote.test/tags/duplicate',
          nameNormalized: 'duplicate',
          createdAt,
          updatedAt: createdAt
        }
      ])

      await expect(
        database.reindexSearchHashtags({
          limit: 10
        })
      ).resolves.toMatchObject({
        indexed: 2,
        nextCursor: null
      })
    } finally {
      await database.destroy()
    }
  })

  it('uses bounded lookups when removing stale hashtag search documents', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const queries: { bindings: unknown[]; sql: string }[] = []
    const handleQuery = ({
      bindings,
      sql
    }: {
      bindings?: unknown[]
      sql: string
    }) => {
      queries.push({
        bindings: bindings ?? [],
        sql: sql.toLowerCase()
      })
    }

    try {
      await database.migrate()
      await database.upsertSearchDocument({
        entityType: 'hashtag',
        entityId: 'orphaned',
        documentText: 'orphaned #orphaned',
        postCount: 3,
        lastPostAt: 1
      })

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchHashtags({
        limit: 10
      })
      knexDatabase.off('query', handleQuery)

      expect(queries.some(({ sql }) => sql.includes('not exists'))).toBe(false)
      expect(
        queries.some(
          ({ sql }) =>
            sql.includes('from `tags`') && sql.includes('`namenormalized` in')
        )
      ).toBe(true)
      const staleCleanupSelect = queries.find(
        ({ sql }) =>
          sql.startsWith('select') &&
          sql.includes('from `search_documents`') &&
          sql.includes('order by `entityid` asc') &&
          sql.includes('limit')
      )
      expect(Number(staleCleanupSelect?.bindings.at(-1))).toBeLessThanOrEqual(
        100
      )
    } finally {
      knexDatabase.off('query', handleQuery)
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

  it('deduplicates hashtag search aggregates across legacy tag name variants', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const firstStatusId = `${actorId}/statuses/duplicate-hashtag-1`
    const secondStatusId = `${actorId}/statuses/duplicate-hashtag-2`
    const distinctTagQueries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      if (
        sql.toLowerCase().startsWith('select distinct') &&
        (sql.includes('from `tags`') || sql.includes('from "tags"'))
      ) {
        distinctTagQueries.push(sql)
      }
    }

    try {
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await database.createNote({
        id: firstStatusId,
        url: firstStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Duplicate hashtag day 1',
        createdAt: 1
      })
      await database.createNote({
        id: secondStatusId,
        url: secondStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Duplicate hashtag day 2',
        createdAt: 3
      })
      await knexDatabase('tags').insert([
        {
          id: crypto.randomUUID(),
          statusId: firstStatusId,
          type: 'hashtag',
          name: '#Cycling',
          value: 'https://remote.test/tags/cycling',
          nameNormalized: '#cycling',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: crypto.randomUUID(),
          statusId: secondStatusId,
          type: 'hashtag',
          name: '#Cycling',
          value: 'https://remote.test/tags/cycling',
          nameNormalized: 'cycling',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ])

      knexDatabase.on('query', handleQuery)
      await database.reindexSearchHashtags({
        limit: 10
      })
      knexDatabase.off('query', handleQuery)

      expect(distinctTagQueries).toHaveLength(1)
      expect(distinctTagQueries[0]).not.toContain('case when')

      await expect(
        database.searchHashtags({
          q: 'cycling',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'cycling',
          postCount: 2,
          lastPostAt: 3
        })
      ])
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('counts a status once when it has both hashtag storage variants', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/duplicate-variant-hashtag`

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
        text: 'Duplicate storage variant hashtag',
        createdAt: 1
      })
      await knexDatabase('tags').insert([
        {
          id: crypto.randomUUID(),
          statusId,
          type: 'hashtag',
          name: '#Cycling',
          value: 'https://remote.test/tags/cycling',
          nameNormalized: '#cycling',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: crypto.randomUUID(),
          statusId,
          type: 'hashtag',
          name: 'Cycling',
          value: 'https://remote.test/tags/cycling',
          nameNormalized: 'cycling',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ])

      await database.reindexSearchHashtags({
        limit: 10
      })

      await expect(
        database.searchHashtags({
          q: 'cycling',
          limit: 10
        })
      ).resolves.toEqual([
        expect.objectContaining({
          name: 'cycling',
          postCount: 1,
          lastPostAt: 1
        })
      ])
    } finally {
      await database.destroy()
    }
  })

  it('replaces hashtag search documents inside a transaction', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/transactional-hashtag`
    const queries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      queries.push(sql.toLowerCase())
    }

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
        text: 'Transactional hashtag day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#Atomic',
        value: 'https://remote.test/tags/atomic'
      })

      knexDatabase.on('query', handleQuery)
      await database.indexHashtagSearchDocuments({
        hashtags: ['atomic']
      })
      knexDatabase.off('query', handleQuery)

      const beginIndex = queries.findIndex((sql) => sql.startsWith('begin'))
      const searchDocumentWriteIndex = queries.findIndex(
        (sql) =>
          sql.includes('search_documents') &&
          (sql.startsWith('insert') ||
            sql.startsWith('update') ||
            sql.startsWith('delete'))
      )
      const commitIndex = queries.findIndex((sql) => sql.startsWith('commit'))

      expect(beginIndex).toBeGreaterThanOrEqual(0)
      expect(searchDocumentWriteIndex).toBeGreaterThan(beginIndex)
      expect(commitIndex).toBeGreaterThan(searchDocumentWriteIndex)
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })

  it('chunks hashtag reindex queries below SQLite bind limits', async () => {
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

      await expect(
        database.indexHashtagSearchDocuments({
          hashtags: Array.from({ length: 999 }, (_, index) => `tag${index}`)
        })
      ).resolves.toBeUndefined()
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

  it('reads visibility-change hashtags inside the update transaction', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/transaction-visibility-hashtag`
    const queries: string[] = []
    const handleQuery = ({ sql }: { sql: string }) => {
      queries.push(sql.toLowerCase())
    }

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
        text: 'Private hashtag transaction',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#VisibilityTransaction',
        value: 'https://remote.test/tags/visibilitytransaction'
      })

      knexDatabase.on('query', handleQuery)
      await database.updateNoteVisibility({
        statusId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: []
      })
      knexDatabase.off('query', handleQuery)

      const tagReadIndex = queries.findIndex(
        (sql) =>
          sql.startsWith('select `statusid`, `name` from `tags`') &&
          sql.includes('`statusid` in')
      )
      const beginIndex = queries.findLastIndex(
        (sql, index) => index < tagReadIndex && sql.startsWith('begin')
      )
      const commitIndex = queries.findIndex(
        (sql, index) => index > tagReadIndex && sql.startsWith('commit')
      )

      expect(beginIndex).toBeGreaterThanOrEqual(0)
      expect(tagReadIndex).toBeGreaterThan(beginIndex)
      expect(commitIndex).toBeGreaterThan(tagReadIndex)
    } finally {
      knexDatabase.off('query', handleQuery)
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

  it('refreshes deleted actor hashtag search aggregates after actor data commits', async () => {
    const knexDatabase = knex({
      client: 'better-sqlite3',
      useNullAsDefault: true,
      connection: {
        filename: ':memory:'
      }
    })
    const database = getSQLDatabase(knexDatabase)
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/actor-delete-commit-hashtag`
    const queries: { bindings: unknown[]; sql: string }[] = []
    const handleQuery = ({
      bindings,
      sql
    }: {
      bindings?: unknown[]
      sql: string
    }) => {
      queries.push({ bindings: bindings ?? [], sql: sql.toLowerCase() })
    }

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
        text: 'Actor deletion commit hashtag day',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'hashtag',
        name: '#CommitCleanup',
        value: 'https://remote.test/tags/commitcleanup'
      })

      knexDatabase.on('query', handleQuery)
      await database.deleteActorData({ actorId })
      knexDatabase.off('query', handleQuery)

      const actorCommitIndex = queries.findIndex((query) =>
        query.sql.startsWith('commit')
      )
      const hashtagSearchWriteIndex = queries.findIndex(
        (query) =>
          query.sql.includes('search_documents') &&
          (query.sql.startsWith('insert') || query.sql.startsWith('delete')) &&
          query.bindings.includes('hashtag')
      )

      expect(actorCommitIndex).toBeGreaterThanOrEqual(0)
      expect(hashtagSearchWriteIndex).toBeGreaterThan(actorCommitIndex)
    } finally {
      knexDatabase.off('query', handleQuery)
      await database.destroy()
    }
  })
})
