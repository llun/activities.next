import { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from './account'
import { ActorSQLDatabaseMixin } from './actor'
import { BlockSQLDatabaseMixin } from './block'
import { BookmarkSQLDatabaseMixin } from './bookmark'
import { FitnessSettingsSQLDatabaseMixin } from './fitnessSettings'
import { FollowerSQLDatabaseMixin } from './follow'
import { getSQLDatabase } from './index'
import { MediaSQLDatabaseMixin } from './media'
import { NotificationSQLDatabaseMixin } from './notification'
import { OAuthSQLDatabaseMixin } from './oauth'
import { SearchSQLDatabaseMixin } from './search'
import { StatusSQLDatabaseMixin } from './status'
import { StatusDetectedLanguageSQLDatabaseMixin } from './statusDetectedLanguage'
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

vi.mock('@/lib/database/sql/account', () => ({
  AccountSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/actor', () => ({
  ActorSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/block', () => ({
  BlockSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/bookmark', () => ({
  BookmarkSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/fitnessSettings', () => ({
  FitnessSettingsSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/follow', () => ({
  FollowerSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/media', () => ({
  MediaSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/notification', () => ({
  NotificationSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/oauth', () => ({
  OAuthSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/search', () => ({
  SearchSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/status', () => ({
  StatusSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/statusDetectedLanguage', () => ({
  StatusDetectedLanguageSQLDatabaseMixin: vi.fn()
}))

vi.mock('@/lib/database/sql/timeline', () => ({
  TimelineSQLDatabaseMixin: vi.fn()
}))

describe('getSQLDatabase', () => {
  const accountMixinMock = AccountSQLDatabaseMixin as unknown as jest.Mock
  const actorMixinMock = ActorSQLDatabaseMixin as unknown as jest.Mock
  const blockMixinMock = BlockSQLDatabaseMixin as unknown as jest.Mock
  const bookmarkMixinMock = BookmarkSQLDatabaseMixin as unknown as jest.Mock
  const fitnessSettingsMixinMock =
    FitnessSettingsSQLDatabaseMixin as unknown as jest.Mock
  const followerMixinMock = FollowerSQLDatabaseMixin as unknown as jest.Mock
  const mediaMixinMock = MediaSQLDatabaseMixin as unknown as jest.Mock
  const notificationMixinMock =
    NotificationSQLDatabaseMixin as unknown as jest.Mock
  const oauthMixinMock = OAuthSQLDatabaseMixin as unknown as jest.Mock
  const searchMixinMock = SearchSQLDatabaseMixin as unknown as jest.Mock
  const statusMixinMock = StatusSQLDatabaseMixin as unknown as jest.Mock
  const statusDetectedLanguageMixinMock =
    StatusDetectedLanguageSQLDatabaseMixin as unknown as jest.Mock
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

    const accountDatabase = {
      isAccountExists: vi.fn(),
      testPriority: 'account'
    }
    const actorDatabase = {
      getActorFromId: vi.fn(),
      testPriority: 'actor'
    }
    const fitnessSettingsDatabase = {
      createFitnessSettings: vi.fn()
    }
    const blockDatabase = {
      createBlock: vi.fn()
    }
    const bookmarkDatabase = {
      createBookmark: vi.fn()
    }
    const followerDatabase = {
      getFollowers: vi.fn()
    }
    const mediaDatabase = {
      createMedia: vi.fn()
    }
    const notificationDatabase = {
      createNotification: vi.fn()
    }
    const oauthDatabase = {
      getClientFromId: vi.fn()
    }
    const searchDatabase = {
      searchDocuments: vi.fn()
    }
    const statusDatabase = {
      getStatus: vi.fn()
    }
    const statusDetectedLanguageDatabase = {
      getDetectedLanguage: vi.fn()
    }
    const timelineDatabase = {
      getTimeline: vi.fn(),
      testPriority: 'timeline'
    }

    _knexMock = knexDatabase
    accountMixinMock.mockReturnValue(accountDatabase)
    actorMixinMock.mockReturnValue(actorDatabase)
    blockMixinMock.mockReturnValue(blockDatabase)
    bookmarkMixinMock.mockReturnValue(bookmarkDatabase)
    fitnessSettingsMixinMock.mockReturnValue(fitnessSettingsDatabase)
    followerMixinMock.mockReturnValue(followerDatabase)
    mediaMixinMock.mockReturnValue(mediaDatabase)
    notificationMixinMock.mockReturnValue(notificationDatabase)
    oauthMixinMock.mockReturnValue(oauthDatabase)
    searchMixinMock.mockReturnValue(searchDatabase)
    statusMixinMock.mockReturnValue(statusDatabase)
    statusDetectedLanguageMixinMock.mockReturnValue(
      statusDetectedLanguageDatabase
    )
    timelineMixinMock.mockReturnValue(timelineDatabase)

    const database = getSQLDatabase(knexDatabase)

    return {
      accountDatabase,
      actorDatabase,
      blockDatabase,
      bookmarkDatabase,
      database,
      followerDatabase,
      fitnessSettingsDatabase,
      knexDatabase,
      mediaDatabase,
      notificationDatabase,
      oauthDatabase,
      searchDatabase,
      statusDatabase,
      statusDetectedLanguageDatabase,
      timelineDatabase
    }
  }

  it('wires mixin dependencies correctly', () => {
    const {
      actorDatabase,
      bookmarkDatabase,
      knexDatabase,
      mediaDatabase,
      statusDatabase,
      statusDetectedLanguageDatabase
    } = createComposedDatabase()

    expect(accountMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(actorMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(blockMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(bookmarkMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(fitnessSettingsMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(followerMixinMock).toHaveBeenCalledWith(knexDatabase, actorDatabase)
    expect(mediaMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(notificationMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(oauthMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(searchMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(statusDetectedLanguageMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(statusMixinMock).toHaveBeenCalledWith(
      knexDatabase,
      actorDatabase,
      // Likes are Kysely queries bound lazily to this Knex instance (see the
      // dedicated test below).
      expect.objectContaining({
        createLike: expect.any(Function),
        isActorLikedStatus: expect.any(Function)
      }),
      bookmarkDatabase,
      mediaDatabase,
      statusDetectedLanguageDatabase,
      expect.objectContaining({
        getStatusReactionRollups: expect.any(Function)
      }),
      expect.objectContaining({
        getStatusLinkPreviews: expect.any(Function)
      })
    )
    expect(timelineMixinMock).toHaveBeenCalledWith(knexDatabase, statusDatabase)
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
