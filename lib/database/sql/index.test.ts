import { Knex } from 'knex'

import { actorQueries } from '@/lib/database/domains/actor/queries'
import { createCollectionQueries } from '@/lib/database/domains/collection/queries'
import { createListQueries } from '@/lib/database/domains/list/queries'
import { statusQueries } from '@/lib/database/domains/status/queries'
import { createTimelineQueries } from '@/lib/database/domains/timeline/queries'

import { getSQLDatabase } from './index'

const { kyselyForMock, createLikeMock } = vi.hoisted(() => ({
  kyselyForMock: vi.fn(),
  createLikeMock: vi.fn()
}))

vi.mock('@/lib/database/kysely', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/database/kysely')>()),
  kyselyFor: kyselyForMock
}))

vi.mock('@/lib/database/domains/like/queries', () => ({
  likeQueries: { createLike: createLikeMock, isActorLikedStatus: vi.fn() },
  isActorLikedStatus: vi.fn()
}))

// The list, collection and timeline factories run for real; the spies record
// the status hydration the facade injects into each.
vi.mock('@/lib/database/domains/list/queries', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/domains/list/queries')>()
  return { ...original, createListQueries: vi.fn(original.createListQueries) }
})

vi.mock('@/lib/database/domains/collection/queries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/database/domains/collection/queries')
    >()
  return {
    ...original,
    createCollectionQueries: vi.fn(original.createCollectionQueries)
  }
})

vi.mock('@/lib/database/domains/timeline/queries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/database/domains/timeline/queries')
    >()
  return {
    ...original,
    createTimelineQueries: vi.fn(original.createTimelineQueries)
  }
})

// The status queries are a copy of the real ones, so a test can swap one out
// before building the facade.
vi.mock('@/lib/database/domains/status/queries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/database/domains/status/queries')
    >()
  return { ...original, statusQueries: { ...original.statusQueries } }
})

// The same for the actor queries.
vi.mock('@/lib/database/domains/actor/queries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/database/domains/actor/queries')
    >()
  return { ...original, actorQueries: { ...original.actorQueries } }
})

describe('getSQLDatabase', () => {
  const createListQueriesMock = vi.mocked(createListQueries)
  const createCollectionQueriesMock = vi.mocked(createCollectionQueries)
  const createTimelineQueriesMock = vi.mocked(createTimelineQueries)
  const mutableStatusQueries = statusQueries as unknown as Record<
    string,
    unknown
  >
  const realStatusQueries = { ...mutableStatusQueries }
  const mutableActorQueries = actorQueries as unknown as Record<string, unknown>
  const realActorQueries = { ...mutableActorQueries }

  let _knexMock: Knex

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    for (const [queries, real] of [
      [mutableStatusQueries, realStatusQueries],
      [mutableActorQueries, realActorQueries]
    ]) {
      for (const name of Object.keys(queries)) {
        if (!(name in real)) delete queries[name]
      }
      Object.assign(queries, real)
    }
  })

  const createComposedDatabase = () => {
    const knexDatabase = {
      migrate: {
        latest: vi.fn().mockResolvedValue(undefined)
      },
      destroy: vi.fn().mockResolvedValue(undefined)
    } as unknown as Knex

    _knexMock = knexDatabase

    const database = getSQLDatabase(knexDatabase)

    return {
      database,
      knexDatabase
    }
  }

  it('binds the status and actor deletions to kyselyFor(knex), resolved on each call', async () => {
    const kyselyDb = { name: 'kysely' }
    kyselyForMock.mockReturnValue(kyselyDb)
    const deleteStatus = vi.fn().mockResolvedValue(undefined)
    const deleteStatusWithQueueJob = vi.fn().mockResolvedValue(true)
    const deleteStatusEditHistory = vi.fn().mockResolvedValue(undefined)
    const deleteActorData = vi.fn().mockResolvedValue(undefined)
    Object.assign(mutableStatusQueries, {
      deleteStatus,
      deleteStatusWithQueueJob,
      deleteStatusEditHistory
    })
    mutableActorQueries.deleteActorData = deleteActorData
    const { database, knexDatabase } = createComposedDatabase()
    expect(kyselyForMock).not.toHaveBeenCalled()

    const queueJob = { name: 'sendDeleteNote', payload: {} }
    await database.deleteStatus({ statusId: 'status', actorId: 'actor' })
    await expect(
      database.deleteStatusWithQueueJob({
        statusId: 'status',
        actorId: 'actor',
        queueJob: queueJob as never
      })
    ).resolves.toBe(true)
    await database.deleteStatusEditHistory({ statusId: 'status' })
    await database.deleteActorData({ actorId: 'actor' })

    expect(kyselyForMock).toHaveBeenCalledWith(knexDatabase)
    expect(deleteStatus).toHaveBeenCalledWith(kyselyDb, {
      statusId: 'status',
      actorId: 'actor'
    })
    expect(deleteStatusWithQueueJob).toHaveBeenCalledWith(kyselyDb, {
      statusId: 'status',
      actorId: 'actor',
      queueJob
    })
    expect(deleteStatusEditHistory).toHaveBeenCalledWith(kyselyDb, {
      statusId: 'status'
    })
    expect(deleteActorData).toHaveBeenCalledWith(kyselyDb, {
      actorId: 'actor'
    })
  })

  it.each([
    { feed: 'list', factory: () => createListQueriesMock },
    { feed: 'collection', factory: () => createCollectionQueriesMock },
    { feed: 'timeline', factory: () => createTimelineQueriesMock }
  ])(
    'hydrates the $feed feeds through the status facade',
    async ({ factory }) => {
      const statuses = [{ id: 'status' }]
      const getStatusesByIdsQuery = vi.fn().mockResolvedValue(statuses)
      mutableStatusQueries.getStatusesByIds = getStatusesByIdsQuery
      const kyselyDb = { name: 'kysely' }
      kyselyForMock.mockReturnValue(kyselyDb)
      const { knexDatabase } = createComposedDatabase()
      const [getStatusesByIds] = factory().mock.calls[0]

      await expect(getStatusesByIds(['status'], 'viewer')).resolves.toBe(
        statuses
      )
      expect(kyselyForMock).toHaveBeenCalledWith(knexDatabase)
      expect(getStatusesByIdsQuery).toHaveBeenCalledWith(kyselyDb, {
        statusIds: ['status'],
        currentActorId: 'viewer'
      })
    }
  )

  it('binds like queries to kyselyFor(knex), resolved on each call', async () => {
    const { database, knexDatabase } = createComposedDatabase()
    const kyselyDb = { name: 'kysely' }
    kyselyForMock.mockReturnValue(kyselyDb)
    createLikeMock.mockResolvedValue(true)
    expect(kyselyForMock).not.toHaveBeenCalled()

    const params = { actorId: 'actor', statusId: 'status' }
    await expect(database.createLike(params)).resolves.toBe(true)

    expect(kyselyForMock).toHaveBeenCalledWith(knexDatabase)
    expect(createLikeMock).toHaveBeenCalledWith(kyselyDb, params)
  })

  it('merges properties with later domains taking precedence', async () => {
    // The status facade's own properties are on the facade.
    mutableStatusQueries.testPriority = vi.fn().mockResolvedValue('status')
    const { database } = createComposedDatabase()
    const merged = database as unknown as Record<string, () => Promise<string>>
    await expect(merged.testPriority()).resolves.toBe('status')

    // The timeline queries are the last spread: a property they define wins
    // over the status facade's, and is bound to the Kysely instance of this
    // Knex one.
    const kyselyDb = { name: 'kysely' }
    kyselyForMock.mockReturnValue(kyselyDb)
    const testPriority = vi.fn().mockResolvedValue('timeline')
    createTimelineQueriesMock.mockReturnValueOnce({
      testPriority
    } as unknown as ReturnType<typeof createTimelineQueries>)
    const { database: withTimeline, knexDatabase } = createComposedDatabase()
    const mergedWithTimeline = withTimeline as unknown as Record<
      string,
      (...args: unknown[]) => Promise<string>
    >
    await expect(mergedWithTimeline.testPriority('arg')).resolves.toBe(
      'timeline'
    )
    expect(kyselyForMock).toHaveBeenCalledWith(knexDatabase)
    expect(testPriority).toHaveBeenCalledWith(kyselyDb, 'arg')
  })

  it('binds the status queries to kyselyFor(knex)', async () => {
    // A status query is bound to the Kysely instance of this Knex one,
    // resolved on each call.
    const kyselyDb = { name: 'kysely' }
    kyselyForMock.mockReturnValue(kyselyDb)
    const getTags = vi.fn().mockResolvedValue(['tag'])
    mutableStatusQueries.getTags = getTags
    const { database, knexDatabase } = createComposedDatabase()
    expect(kyselyForMock).not.toHaveBeenCalledWith(knexDatabase)
    await expect(database.getTags({ statusId: 'status' })).resolves.toEqual([
      'tag'
    ])
    expect(kyselyForMock).toHaveBeenCalledWith(knexDatabase)
    expect(getTags).toHaveBeenCalledWith(kyselyDb, { statusId: 'status' })

    // The reads, hydration and deletions are Kysely queries too, and the row
    // hydration stays off the facade.
    expect('hydrateStatusRow' in database).toBe(false)
    for (const name of [
      'getStatus',
      'getStatusReplies',
      'getStatusEditHistory',
      'getActorStatusesCount',
      'getActorStatuses',
      'getStatusesByIds',
      'getStatusReblogsCount',
      'getStatusReblogsCounts',
      'getStatusRepliesCount',
      'getStatusRepliesCounts',
      'deleteStatus',
      'deleteStatusWithQueueJob',
      'deleteStatusEditHistory'
    ]) {
      expect(realStatusQueries[name]).toEqual(expect.any(Function))
    }
    expect(realActorQueries.deleteActorData).toEqual(expect.any(Function))
  })

  it('proxies migrate and destroy to knex lifecycle methods', async () => {
    const { database, knexDatabase } = createComposedDatabase()
    await database.migrate()
    expect(knexDatabase.migrate.latest).toHaveBeenCalledTimes(1)

    await database.destroy()
    expect(knexDatabase.destroy).toHaveBeenCalledTimes(1)
  })
})
