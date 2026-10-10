import type { Knex } from 'knex'

import { getSearchTokens } from '@/lib/database/domains/search/rows'
import { normalizeHashtagSearchName } from '@/lib/database/sql/search/hashtag'
import { indexStatusSearchDocument } from '@/lib/database/sql/search/status'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import { FollowStatus } from '@/lib/types/domain/follow'
import { StatusType } from '@/lib/types/domain/status'

describe('SearchDatabase document filtering', () => {
  it('tokenizes Unicode search text', () => {
    expect(getSearchTokens('  Café 東京 runner_1  ')).toEqual([
      'café',
      '東京',
      'runner_1'
    ])
  })

  it('caps the number and length of search tokens', () => {
    const many = Array.from({ length: 5000 }, (_, i) => `term${i}`).join(' ')
    const tokens = getSearchTokens(many)
    expect(tokens).toHaveLength(12)
    expect(tokens[0]).toBe('term0')
    expect(getSearchTokens('a'.repeat(10_000))).toEqual(['a'.repeat(64)])
  })

  it('normalizes hashtag search names with repeated leading hashes', () => {
    expect(normalizeHashtagSearchName('  ##TrailRunning  ')).toBe(
      'trailrunning'
    )
  })

  it('creates SQLite FTS search documents and returns full-text matches', async () => {
    const testDb = createTestDatabase()
    const { database, knex: knexDatabase } = testDb

    try {
      await testDb.prepare()
      await database.migrate()
      await database.upsertSearchDocument({
        entityType: 'account',
        entityId: 'https://remote.test/users/alice',
        documentText: 'alice alice@remote.test Trail runner',
        actorId: 'https://remote.test/users/alice',
        discoverable: true
      })

      if (testDb.backend === 'sqlite') {
        const ftsRows = await knexDatabase.raw(
          'select id from search_documents_fts where search_documents_fts match ?',
          ['runner']
        )
        expect(ftsRows).toEqual([
          { id: 'account:https://remote.test/users/alice' }
        ])
      }

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
    const testDb = createTestDatabase()
    const { database } = testDb

    try {
      await testDb.prepare()
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

  it('indexes a preloaded status row without reading the statuses table', async () => {
    const testDb = createTestDatabase()
    const { database, knex: knexDatabase } = testDb
    const statusId = 'https://remote.test/users/alice/statuses/preloaded'

    try {
      await testDb.prepare()
      await database.migrate()

      await indexStatusSearchDocument(knexDatabase, {
        status: {
          id: statusId,
          actorId: 'https://remote.test/users/alice',
          type: StatusType.enum.Note,
          content: JSON.stringify({
            text: 'Preloaded trail run',
            summary: 'Morning effort'
          }),
          createdAt: new Date('2026-05-25T07:00:00.000Z')
        }
      })

      await expect(
        knexDatabase('search_documents')
          .where({
            entityType: 'status',
            entityId: statusId
          })
          .first()
      ).resolves.toMatchObject({
        documentText: 'Preloaded trail run Morning effort',
        actorId: 'https://remote.test/users/alice',
        visibility: 'direct'
      })
    } finally {
      await database.destroy()
    }
  })

  describe('generic search document filtering by discoverability and status visibility', () => {
    const testDb = createTestDatabase()
    const { database, knex: knexDatabase } = testDb

    beforeAll(async () => {
      await testDb.prepare()
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
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('shows anonymous viewers only public and unlisted statuses and discoverable accounts', async () => {
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
    })

    it('includes non-discoverable accounts only when requested', async () => {
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
    })

    it('shows a viewer without relationships the public and unlisted statuses plus their own private status', async () => {
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
    })

    it('shows a viewer with relationships the statuses addressed to them or to followed actors, but not forged or unfollowed ones', async () => {
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
    })
  })

  describe('executed search statements', () => {
    const testDb = createTestDatabase()
    const { database, knex: knexDatabase } = testDb

    // The text and bindings of the SELECTs over search_documents that `run`
    // sends, as the driver reports them to Knex's query event.
    const captureSearches = async (run: () => Promise<unknown>) => {
      const searches: { sql: string; bindings: unknown[] }[] = []
      const capture = ({
        sql,
        bindings
      }: {
        sql: string
        bindings: unknown[]
      }) => {
        if (sql.startsWith('select') && sql.includes('from "search_documents"'))
          searches.push({ sql, bindings })
      }
      knexDatabase.on('query', capture)
      try {
        await run()
      } finally {
        knexDatabase.off('query', capture)
      }
      return searches
    }
    const orderBy = (sql: string) => sql.slice(sql.indexOf(' order by '))

    beforeAll(async () => {
      await testDb.prepare()
      await database.migrate()
    })

    afterAll(async () => {
      await database.destroy()
    })

    it('only applies entityId ranking boosts to hashtag searches', async () => {
      const [plain, hashtag] = await captureSearches(async () => {
        await database.searchDocuments({
          entityType: 'account',
          q: 'runner',
          limit: 10
        })
        await database.searchDocuments({
          entityType: 'hashtag',
          q: '#runner',
          limit: 10
        })
      })

      expect(plain.sql).not.toContain('"entityId") =')
      expect(plain.sql).not.toContain('lower("search_documents"."entityId")')
      expect(plain.bindings).not.toContain('runner%')
      expect(orderBy(plain.sql)).toContain(
        '"search_documents"."postCount" desc nulls last, "search_documents"."lastPostAt" desc nulls last, "search_documents"."entityCreatedAt" desc nulls last, "search_documents"."entityId" desc'
      )
      expect(orderBy(plain.sql)).not.toContain('is null')

      expect(orderBy(hashtag.sql)).toContain(
        'lower("search_documents"."entityId")'
      )
      expect(hashtag.bindings).toEqual(
        expect.arrayContaining(['runner', 'runner%'])
      )
    })
  })

  it('matches database clients by exact supported names', async () => {
    const migration =
      await import('@/migrations/20260523000000_add_search_documents.js')

    const raw = vi.fn().mockResolvedValue(undefined)
    const schema = {
      createTable: vi.fn().mockResolvedValue(undefined)
    }
    await migration.up({
      client: { config: { client: 'pgcluster' } },
      schema,
      raw,
      fn: { now: vi.fn() }
    } as unknown as Knex)
    expect(raw).not.toHaveBeenCalled()
  })
})
