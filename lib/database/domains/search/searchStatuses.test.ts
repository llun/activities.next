import { getSearchDocumentId } from '@/lib/database/domains/search/rows'
import { createTestDatabase } from '@/lib/database/testing/createTestDatabase'
import {
  createSearchActor,
  insertRowsInChunks
} from '@/lib/database/testing/searchTestHelpers'
import { StatusType } from '@/lib/types/domain/status'
import { ACTIVITY_STREAM_PUBLIC } from '@/lib/utils/activitystream'

describe('SearchDatabase statuses', () => {
  it('indexes status text, strips HTML, and updates status search documents on edits', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/status-search-update`

    try {
      await testDb.prepare()
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
        text: '<p>Original <strong>trailblazer</strong></p>',
        createdAt: 1
      })

      await expect(
        database.searchStatusIds({
          q: 'trailblazer',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([statusId])

      await database.updateNote({
        statusId,
        text: '<p>Edited summitmarker</p>',
        summary: ''
      })

      await expect(
        database.searchStatusIds({
          q: 'trailblazer',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([])
      await expect(
        database.searchStatusIds({
          q: 'summitmarker',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([statusId])

      await database.deleteStatus({ statusId })

      await expect(
        database.searchStatusIds({
          q: 'summitmarker',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('preserves word boundaries when indexing status HTML', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/status-search-html-spacing`

    try {
      await testDb.prepare()
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
        text: '<p>alpineword</p><p>ridgeword</p>',
        createdAt: 1
      })

      await expect(
        database.searchStatusIds({
          q: 'ridgeword',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([statusId])
    } finally {
      await database.destroy()
    }
  })

  it('rebuilds status search documents in batches', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/status-search-reindex`

    try {
      await testDb.prepare()
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
        text: '<p>Batch reindexable summitword</p>',
        createdAt: 1
      })
      await database.deleteStatusSearchDocument({ statusId })

      await expect(
        database.reindexSearchStatuses({ limit: 10 })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        database.searchStatusIds({
          q: 'summitword',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([statusId])
    } finally {
      await database.destroy()
    }
  })

  it('indexes legacy raw-string status content', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusId = `${actorId}/statuses/raw-string-search`
    const currentTime = new Date()

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await db
        .insertInto('statuses')
        .values({
          id: statusId,
          url: statusId,
          actorId,
          type: StatusType.enum.Note,
          content: '<p>Legacy raw string summitlegacy</p>',
          reply: '',
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .execute()
      await db
        .insertInto('recipients')
        .values({
          id: crypto.randomUUID(),
          statusId,
          actorId: ACTIVITY_STREAM_PUBLIC,
          type: 'to',
          createdAt: currentTime,
          updatedAt: currentTime
        })
        .execute()

      await expect(
        database.reindexSearchStatuses({ limit: 10 })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        database.searchStatusIds({
          q: 'summitlegacy',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([statusId])
    } finally {
      await database.destroy()
    }
  })

  it('uses status creation time for stable reindex pagination', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const actorId = 'https://remote.test/users/alice'
    const firstStatusId = `${actorId}/statuses/m-cursor`
    const secondStatusId = `${actorId}/statuses/a-newer-status`

    try {
      await testDb.prepare()
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
        text: 'firstcursorword',
        createdAt: 1
      })

      const firstPage = await database.reindexSearchStatuses({ limit: 1 })
      expect(firstPage.indexed).toBe(1)
      expect(firstPage.nextCursor).toContain('status-created-at:')
      expect(firstPage.nextCursor).not.toBe(firstStatusId)

      await database.createNote({
        id: secondStatusId,
        url: secondStatusId,
        actorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'secondcursorword',
        createdAt: 2
      })
      await database.deleteStatus({ statusId: firstStatusId })
      await database.deleteStatusSearchDocument({ statusId: secondStatusId })

      await expect(
        database.reindexSearchStatuses({
          afterId: firstPage.nextCursor,
          limit: 10
        })
      ).resolves.toEqual({ indexed: 1, nextCursor: null })
      await expect(
        database.searchStatusIds({
          q: 'secondcursorword',
          limit: 10,
          currentActorId: actorId
        })
      ).resolves.toEqual([secondStatusId])
    } finally {
      await database.destroy()
    }
  })

  it('deletes stale status search documents in SQLite-safe batches', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusCount = 1005
    const currentTime = new Date()
    const statuses = Array.from({ length: statusCount }, (_, index) => {
      const statusId = `${actorId}/statuses/stale-empty-${index}`
      return {
        id: statusId,
        url: statusId,
        actorId,
        type: StatusType.enum.Note,
        content: JSON.stringify({
          url: statusId,
          text: '',
          summary: ''
        }),
        reply: '',
        createdAt: currentTime,
        updatedAt: currentTime
      }
    })

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await insertRowsInChunks(db, 'statuses', statuses, 100)
      await insertRowsInChunks(
        db,
        'search_documents',
        statuses.map((status) => ({
          id: getSearchDocumentId({
            entityType: 'status',
            entityId: status.id
          }),
          entityType: 'status',
          entityId: status.id,
          documentText: 'stale text',
          actorId,
          visibility: 'public',
          entityCreatedAt: currentTime,
          discoverable: null,
          postCount: null,
          lastPostAt: null,
          createdAt: currentTime,
          updatedAt: currentTime
        })),
        80
      )

      await expect(
        database.reindexSearchStatuses({ limit: statusCount + 1 })
      ).resolves.toEqual({ indexed: statusCount, nextCursor: null })

      const countRow = await db
        .selectFrom('search_documents')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('entityType', '=', 'status')
        .executeTakeFirst()
      expect(Number(countRow?.count ?? 0)).toBe(0)
    } finally {
      await database.destroy()
    }
  })

  it('requires status search matches to be interacted-with or owned', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const viewerId = 'https://remote.test/users/viewer'
    const authorId = 'https://remote.test/users/author'
    const statusId = `${authorId}/statuses/public-search`

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: viewerId,
        username: 'viewer'
      })
      await createSearchActor(database, {
        id: authorId,
        username: 'author'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: authorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Public but not broadly searchable keyworddelta',
        createdAt: 1
      })

      await expect(
        database.searchStatusIds({
          q: 'keyworddelta',
          limit: 10,
          currentActorId: viewerId
        })
      ).resolves.toEqual([])

      await database.createLike({
        actorId: viewerId,
        statusId
      })

      await expect(
        database.searchStatusIds({
          q: 'keyworddelta',
          limit: 10,
          currentActorId: viewerId
        })
      ).resolves.toEqual([statusId])
      await expect(
        database.searchStatusIds({
          q: 'keyworddelta',
          limit: 10,
          currentActorId: `${viewerId}#main-key`
        })
      ).resolves.toEqual([statusId])
    } finally {
      await database.destroy()
    }
  })

  it('returns mentioned statuses and filters blocked authors', async () => {
    const testDb = createTestDatabase()
    const { database } = testDb
    const viewerId = 'https://remote.test/users/viewer'
    const authorId = 'https://remote.test/users/author'
    const statusId = `${authorId}/statuses/mention-search`
    const missingHrefStatusId = `${authorId}/statuses/mention-search-empty-value`

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: authorId,
        username: 'author'
      })
      await database.createNote({
        id: statusId,
        url: statusId,
        actorId: authorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Direct mention searchword',
        createdAt: 1
      })
      await database.createTag({
        statusId,
        type: 'mention',
        name: '@viewer',
        value: viewerId
      })

      await expect(
        database.searchStatusIds({
          q: 'searchword',
          limit: 10,
          currentActorId: viewerId,
          currentActorUsername: 'viewer',
          currentActorDomain: 'remote.test'
        })
      ).resolves.toEqual([statusId])

      await expect(
        database.searchStatusIds({
          q: 'searchword',
          limit: 10,
          currentActorId: `${viewerId}#main-key`,
          currentActorUsername: 'viewer',
          currentActorDomain: 'remote.test'
        })
      ).resolves.toEqual([statusId])

      await database.createNote({
        id: missingHrefStatusId,
        url: missingHrefStatusId,
        actorId: authorId,
        to: [ACTIVITY_STREAM_PUBLIC],
        cc: [],
        text: 'Mention without href fallbackword',
        createdAt: 2
      })
      await database.createTag({
        statusId: missingHrefStatusId,
        type: 'mention',
        name: '@viewer',
        value: ''
      })

      await expect(
        database.searchStatusIds({
          q: 'fallbackword',
          limit: 10,
          currentActorId: viewerId,
          currentActorUsername: 'viewer',
          currentActorDomain: 'remote.test'
        })
      ).resolves.toEqual([missingHrefStatusId])

      await database.createBlock({
        actorId: viewerId,
        targetActorId: authorId,
        uri: `${viewerId}#blocks/${encodeURIComponent(authorId)}`
      })

      await expect(
        database.searchStatusIds({
          q: 'searchword',
          limit: 10,
          currentActorId: viewerId,
          currentActorUsername: 'viewer',
          currentActorDomain: 'remote.test'
        })
      ).resolves.toEqual([])
      await expect(
        database.searchStatusIds({
          q: 'searchword',
          limit: 10,
          currentActorId: `${viewerId}#main-key`,
          currentActorUsername: 'viewer',
          currentActorDomain: 'remote.test'
        })
      ).resolves.toEqual([])
    } finally {
      await database.destroy()
    }
  })

  it('deletes actor status search documents in SQLite-safe batches', async () => {
    const testDb = createTestDatabase()
    const { database, db } = testDb
    const actorId = 'https://remote.test/users/alice'
    const statusCount = 1005
    const currentTime = new Date()
    const statuses = Array.from({ length: statusCount }, (_, index) => {
      const statusId = `${actorId}/statuses/delete-search-${index}`
      return {
        id: statusId,
        url: statusId,
        actorId,
        type: StatusType.enum.Note,
        content: JSON.stringify({
          url: statusId,
          text: `Delete searchable status ${index}`,
          summary: ''
        }),
        reply: '',
        createdAt: currentTime,
        updatedAt: currentTime
      }
    })

    try {
      await testDb.prepare()
      await database.migrate()
      await createSearchActor(database, {
        id: actorId,
        username: 'alice'
      })
      await insertRowsInChunks(db, 'statuses', statuses, 100)
      await insertRowsInChunks(
        db,
        'search_documents',
        statuses.map((status) => ({
          id: getSearchDocumentId({
            entityType: 'status',
            entityId: status.id
          }),
          entityType: 'status',
          entityId: status.id,
          documentText: 'delete searchable status',
          actorId,
          visibility: 'public',
          entityCreatedAt: currentTime,
          discoverable: null,
          postCount: null,
          lastPostAt: null,
          createdAt: currentTime,
          updatedAt: currentTime
        })),
        80
      )

      await expect(database.deleteActorData({ actorId })).resolves.toBe(
        undefined
      )

      const [statusCountRow, searchDocumentCountRow] = await Promise.all([
        db
          .selectFrom('statuses')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('actorId', '=', actorId)
          .executeTakeFirst(),
        db
          .selectFrom('search_documents')
          .select((eb) => eb.fn.countAll<number>().as('count'))
          .where('entityType', '=', 'status')
          .where('actorId', '=', actorId)
          .executeTakeFirst()
      ])
      expect(Number(statusCountRow?.count ?? 0)).toBe(0)
      expect(Number(searchDocumentCountRow?.count ?? 0)).toBe(0)
    } finally {
      await database.destroy()
    }
  })
})
