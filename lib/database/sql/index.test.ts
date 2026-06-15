import { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from './account'
import { ActorSQLDatabaseMixin } from './actor'
import { BlockSQLDatabaseMixin } from './block'
import { BookmarkSQLDatabaseMixin } from './bookmark'
import { FitnessSettingsSQLDatabaseMixin } from './fitnessSettings'
import { FollowerSQLDatabaseMixin } from './follow'
import { getSQLDatabase } from './index'
import { LikeSQLDatabaseMixin } from './like'
import { MediaSQLDatabaseMixin } from './media'
import { NotificationSQLDatabaseMixin } from './notification'
import { OAuthSQLDatabaseMixin } from './oauth'
import { SearchSQLDatabaseMixin } from './search'
import { StatusSQLDatabaseMixin } from './status'
import { TimelineSQLDatabaseMixin } from './timeline'

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

vi.mock('@/lib/database/sql/like', () => ({
  LikeSQLDatabaseMixin: vi.fn()
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
  const likeMixinMock = LikeSQLDatabaseMixin as unknown as jest.Mock
  const mediaMixinMock = MediaSQLDatabaseMixin as unknown as jest.Mock
  const notificationMixinMock =
    NotificationSQLDatabaseMixin as unknown as jest.Mock
  const oauthMixinMock = OAuthSQLDatabaseMixin as unknown as jest.Mock
  const searchMixinMock = SearchSQLDatabaseMixin as unknown as jest.Mock
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
    const likeDatabase = {
      createLike: vi.fn()
    }
    const mediaDatabase = {
      createMedia: vi.fn()
    }
    const notificationDatabase = {
      createNotification: vi.fn()
    }
    const oauthDatabase = {
      getClientFromName: vi.fn()
    }
    const searchDatabase = {
      searchDocuments: vi.fn()
    }
    const statusDatabase = {
      getStatus: vi.fn()
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
    likeMixinMock.mockReturnValue(likeDatabase)
    mediaMixinMock.mockReturnValue(mediaDatabase)
    notificationMixinMock.mockReturnValue(notificationDatabase)
    oauthMixinMock.mockReturnValue(oauthDatabase)
    searchMixinMock.mockReturnValue(searchDatabase)
    statusMixinMock.mockReturnValue(statusDatabase)
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
      likeDatabase,
      mediaDatabase,
      notificationDatabase,
      oauthDatabase,
      searchDatabase,
      statusDatabase,
      timelineDatabase
    }
  }

  it('wires mixin dependencies correctly', () => {
    const {
      actorDatabase,
      bookmarkDatabase,
      knexDatabase,
      likeDatabase,
      mediaDatabase,
      statusDatabase
    } = createComposedDatabase()

    expect(accountMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(actorMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(blockMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(bookmarkMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(fitnessSettingsMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(followerMixinMock).toHaveBeenCalledWith(knexDatabase, actorDatabase)
    expect(likeMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(mediaMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(notificationMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(oauthMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(searchMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(statusMixinMock).toHaveBeenCalledWith(
      knexDatabase,
      actorDatabase,
      likeDatabase,
      bookmarkDatabase,
      mediaDatabase
    )
    expect(timelineMixinMock).toHaveBeenCalledWith(knexDatabase, statusDatabase)
  })

  it('exposes methods from all composed mixins', () => {
    const {
      accountDatabase,
      actorDatabase,
      blockDatabase,
      bookmarkDatabase,
      database,
      followerDatabase,
      fitnessSettingsDatabase,
      likeDatabase,
      mediaDatabase,
      notificationDatabase,
      oauthDatabase,
      searchDatabase,
      statusDatabase,
      timelineDatabase
    } = createComposedDatabase()

    expect(database.isAccountExists).toBe(accountDatabase.isAccountExists)
    expect(database.getActorFromId).toBe(actorDatabase.getActorFromId)
    expect(database.createBlock).toBe(blockDatabase.createBlock)
    expect(database.createBookmark).toBe(bookmarkDatabase.createBookmark)
    expect(database.createFitnessSettings).toBe(
      fitnessSettingsDatabase.createFitnessSettings
    )
    expect(database.getFollowers).toBe(followerDatabase.getFollowers)
    expect(database.createLike).toBe(likeDatabase.createLike)
    expect(database.createMedia).toBe(mediaDatabase.createMedia)
    expect(database.createNotification).toBe(
      notificationDatabase.createNotification
    )
    expect(database.getClientFromName).toBe(oauthDatabase.getClientFromName)
    expect(database.searchDocuments).toBe(searchDatabase.searchDocuments)
    expect(database.getStatus).toBe(statusDatabase.getStatus)
    expect(database.getTimeline).toBe(timelineDatabase.getTimeline)
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
