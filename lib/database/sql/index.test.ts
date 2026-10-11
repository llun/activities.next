import { Knex } from 'knex'

import { createCollectionQueries } from '@/lib/database/domains/collection/queries'
import { createListQueries } from '@/lib/database/domains/list/queries'
import { createStatusQueries } from '@/lib/database/domains/status/queries'
import { createTimelineQueries } from '@/lib/database/domains/timeline/queries'

import { getSQLDatabase } from './index'
import { MediaSQLDatabaseMixin } from './media'
import { StatusSQLDatabaseMixin } from './status'

const { kyselyForMock, createLikeMock } = vi.hoisted(() => ({
  kyselyForMock: vi.fn(),
  createLikeMock: vi.fn()
}))

vi.mock('@/lib/database/kysely', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/database/kysely')>()),
  kyselyFor: kyselyForMock
}))

vi.mock('@/lib/database/domains/like/queries', () => ({
  likeQueries: { createLike: createLikeMock, isActorLikedStatus: vi.fn() }
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

// The status factory runs for real; the spy records the Knex hydration the
// facade injects into it.
vi.mock('@/lib/database/domains/status/queries', async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import('@/lib/database/domains/status/queries')
    >()
  return {
    ...original,
    createStatusQueries: vi.fn(original.createStatusQueries)
  }
})

vi.mock('@/lib/database/sql/media', () => ({
  MediaSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/status', () => ({
  StatusSQLDatabaseMixin: vi.fn()
}))

describe('getSQLDatabase', () => {
  const createListQueriesMock = vi.mocked(createListQueries)
  const createCollectionQueriesMock = vi.mocked(createCollectionQueries)
  const createTimelineQueriesMock = vi.mocked(createTimelineQueries)
  const createStatusQueriesMock = vi.mocked(createStatusQueries)
  const mediaMixinMock = MediaSQLDatabaseMixin as unknown as jest.Mock
  const statusMixinMock = StatusSQLDatabaseMixin as unknown as jest.Mock

  let _knexMock: Knex

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const createComposedDatabase = () => {
    const knexDatabase = {
      migrate: {
        latest: vi.fn().mockResolvedValue(undefined)
      },
      destroy: vi.fn().mockResolvedValue(undefined)
    } as unknown as Knex

    const mediaDatabase = {
      createMedia: vi.fn(),
      testPriority: 'media'
    }
    const statusDatabase = {
      getStatus: vi.fn(),
      getStatusesByIds: vi.fn(),
      hydrateStatusRow: vi.fn(),
      getTags: vi.fn(),
      testPriority: 'status'
    }

    _knexMock = knexDatabase
    mediaMixinMock.mockReturnValue(mediaDatabase)
    statusMixinMock.mockReturnValue(statusDatabase)

    const database = getSQLDatabase(knexDatabase)

    return {
      database,
      knexDatabase,
      mediaDatabase,
      statusDatabase
    }
  }

  it('wires mixin dependencies correctly', () => {
    const { knexDatabase, mediaDatabase } = createComposedDatabase()
    // Actors are Kysely queries bound lazily to this Knex instance, plus the
    // row mapper and the Knex deleteActorData.
    const actorDatabase = expect.objectContaining({
      getActorFromId: expect.any(Function),
      getMastodonActors: expect.any(Function),
      getActor: expect.any(Function),
      deleteActorData: expect.any(Function)
    })

    expect(mediaMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(statusMixinMock).toHaveBeenCalledWith(
      knexDatabase,
      actorDatabase,
      // Likes are Kysely queries bound lazily to this Knex instance (see the
      // dedicated test below).
      expect.objectContaining({
        createLike: expect.any(Function),
        isActorLikedStatus: expect.any(Function)
      }),
      // Bookmarks are Kysely queries bound lazily to this Knex instance.
      expect.objectContaining({
        createBookmark: expect.any(Function),
        isActorBookmarkedStatus: expect.any(Function)
      }),
      // The Knex media writes, plus the media reads as Kysely queries bound
      // lazily to this Knex instance.
      expect.objectContaining({
        createMedia: mediaDatabase.createMedia,
        getAttachments: expect.any(Function),
        getMediaByIdForAccount: expect.any(Function)
      }),
      // Detected languages are Kysely queries bound lazily to this Knex instance.
      expect.objectContaining({
        getDetectedLanguage: expect.any(Function),
        getDetectedLanguages: expect.any(Function)
      }),
      expect.objectContaining({
        getStatusReactionRollups: expect.any(Function)
      }),
      expect.objectContaining({
        getStatusLinkPreviews: expect.any(Function)
      })
    )
  })

  it.each([
    { feed: 'list', factory: () => createListQueriesMock },
    { feed: 'collection', factory: () => createCollectionQueriesMock },
    { feed: 'timeline', factory: () => createTimelineQueriesMock }
  ])(
    'hydrates the $feed feeds through the status facade',
    async ({ factory }) => {
      const { statusDatabase } = createComposedDatabase()
      const [getStatusesByIds] = factory().mock.calls[0]
      const statuses = [{ id: 'status' }]
      statusDatabase.getStatusesByIds.mockResolvedValue(statuses)

      await expect(getStatusesByIds(['status'], 'viewer')).resolves.toBe(
        statuses
      )
      expect(statusDatabase.getStatusesByIds).toHaveBeenCalledWith({
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

  it('merges properties with later mixins taking precedence', async () => {
    // The status facade is spread after the media one.
    const { database } = createComposedDatabase()
    const merged = database as unknown as Record<string, string>
    expect(merged.testPriority).toBe('status')

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

  it('binds the status lookups to kyselyFor(knex), hydrating through the Knex mixin', async () => {
    const { database, knexDatabase, statusDatabase } = createComposedDatabase()
    const [hydration] = createStatusQueriesMock.mock.calls[0]

    // getStatus and getStatusesByIds are the facade's; the row hydration is
    // handed over and kept off the facade.
    statusDatabase.getStatus.mockResolvedValue({ id: 'one' })
    await expect(hydration.getStatus({ statusId: 'one' })).resolves.toEqual({
      id: 'one'
    })
    expect(statusDatabase.getStatus).toHaveBeenCalledWith({ statusId: 'one' })
    statusDatabase.getStatusesByIds.mockResolvedValue([{ id: 'two' }])
    await expect(
      hydration.getStatusesByIds({ statusIds: ['two'], currentActorId: 'v' })
    ).resolves.toEqual([{ id: 'two' }])
    expect(statusDatabase.getStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['two'],
      currentActorId: 'v'
    })
    expect(hydration.hydrateStatusRow).toBe(statusDatabase.hydrateStatusRow)
    expect('hydrateStatusRow' in database).toBe(false)

    // A Kysely status query wins over a Knex key of the same name, and is
    // bound to the Kysely instance of this Knex one, resolved on each call.
    const kyselyDb = { name: 'kysely' }
    kyselyForMock.mockReturnValue(kyselyDb)
    const getTags = vi.fn().mockResolvedValue(['tag'])
    createStatusQueriesMock.mockReturnValueOnce({
      getTags
    } as unknown as ReturnType<typeof createStatusQueries>)
    const { database: withStatusQueries, knexDatabase: knexForQueries } =
      createComposedDatabase()
    expect(kyselyForMock).not.toHaveBeenCalledWith(knexForQueries)
    await expect(
      withStatusQueries.getTags({ statusId: 'status' })
    ).resolves.toEqual(['tag'])
    expect(kyselyForMock).toHaveBeenCalledWith(knexForQueries)
    expect(getTags).toHaveBeenCalledWith(kyselyDb, { statusId: 'status' })
    expect(knexDatabase).not.toBe(knexForQueries)
  })

  it('proxies migrate and destroy to knex lifecycle methods', async () => {
    const { database, knexDatabase } = createComposedDatabase()
    await database.migrate()
    expect(knexDatabase.migrate.latest).toHaveBeenCalledTimes(1)

    await database.destroy()
    expect(knexDatabase.destroy).toHaveBeenCalledTimes(1)
  })
})
