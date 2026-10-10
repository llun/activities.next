import { Knex } from 'knex'

import { createListQueries } from '@/lib/database/domains/list/queries'

import { getSQLDatabase } from './index'
import { MediaSQLDatabaseMixin } from './media'
import { StatusSQLDatabaseMixin } from './status'
import { TimelineSQLDatabaseMixin } from './timeline'

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

// The list factory runs for real; the spy records the status hydration the
// facade injects into it.
vi.mock('@/lib/database/domains/list/queries', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/lib/database/domains/list/queries')>()
  return { ...original, createListQueries: vi.fn(original.createListQueries) }
})

vi.mock('@/lib/database/sql/media', () => ({
  MediaSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/status', () => ({
  StatusSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/timeline', () => ({
  TimelineSQLDatabaseMixin: vi.fn()
}))

describe('getSQLDatabase', () => {
  const createListQueriesMock = vi.mocked(createListQueries)
  const mediaMixinMock = MediaSQLDatabaseMixin as unknown as jest.Mock
  const statusMixinMock = StatusSQLDatabaseMixin as unknown as jest.Mock
  const timelineMixinMock = TimelineSQLDatabaseMixin as unknown as jest.Mock

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
      createMedia: vi.fn()
    }
    const statusDatabase = {
      getStatus: vi.fn(),
      getStatusesByIds: vi.fn()
    }
    const timelineDatabase = {
      getTimeline: vi.fn(),
      testPriority: 'timeline'
    }

    _knexMock = knexDatabase
    mediaMixinMock.mockReturnValue(mediaDatabase)
    statusMixinMock.mockReturnValue(statusDatabase)
    timelineMixinMock.mockReturnValue(timelineDatabase)

    const database = getSQLDatabase(knexDatabase)

    return {
      database,
      knexDatabase,
      mediaDatabase,
      statusDatabase,
      timelineDatabase
    }
  }

  it('wires mixin dependencies correctly', () => {
    const { knexDatabase, mediaDatabase, statusDatabase } =
      createComposedDatabase()
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
      mediaDatabase,
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
    expect(timelineMixinMock).toHaveBeenCalledWith(knexDatabase, statusDatabase)
  })

  it('hydrates the list timeline through the status facade', async () => {
    const { statusDatabase } = createComposedDatabase()
    const [getStatusesByIds] = createListQueriesMock.mock.calls[0]
    const statuses = [{ id: 'status' }]
    statusDatabase.getStatusesByIds.mockResolvedValue(statuses)

    await expect(getStatusesByIds(['status'], 'viewer')).resolves.toBe(statuses)
    expect(statusDatabase.getStatusesByIds).toHaveBeenCalledWith({
      statusIds: ['status'],
      currentActorId: 'viewer'
    })
  })

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

  it('merges properties with later mixins taking precedence', () => {
    const { database } = createComposedDatabase()
    const merged = database as unknown as Record<string, string>
    expect(merged.testPriority).toBe('timeline')
  })

  it('proxies migrate and destroy to knex lifecycle methods', async () => {
    const { database, knexDatabase } = createComposedDatabase()
    await database.migrate()
    expect(knexDatabase.migrate.latest).toHaveBeenCalledTimes(1)

    await database.destroy()
    expect(knexDatabase.destroy).toHaveBeenCalledTimes(1)
  })
})
