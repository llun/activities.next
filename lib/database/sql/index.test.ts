import knex, { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from './account'
import { ActorSQLDatabaseMixin } from './actor'
import { FitnessSettingsSQLDatabaseMixin } from './fitnessSettings'
import { FollowerSQLDatabaseMixin } from './follow'
import { getSQLDatabase } from './index'
import { LikeSQLDatabaseMixin } from './like'
import { MediaSQLDatabaseMixin } from './media'
import { NotificationSQLDatabaseMixin } from './notification'
import { OAuthSQLDatabaseMixin } from './oauth'
import { StatusSQLDatabaseMixin } from './status'
import { TimelineSQLDatabaseMixin } from './timeline'

jest.mock('knex', () => ({
  __esModule: true,
  default: jest.fn()
}))

jest.mock('@/lib/database/sql/account', () => ({
  AccountSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/actor', () => ({
  ActorSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/fitnessSettings', () => ({
  FitnessSettingsSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/follow', () => ({
  FollowerSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/like', () => ({
  LikeSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/media', () => ({
  MediaSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/notification', () => ({
  NotificationSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/oauth', () => ({
  OAuthSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/status', () => ({
  StatusSQLDatabaseMixin: jest.fn()
}))

jest.mock('@/lib/database/sql/timeline', () => ({
  TimelineSQLDatabaseMixin: jest.fn()
}))

describe('getSQLDatabase', () => {
  const knexMock = knex as unknown as jest.Mock
  const accountMixinMock = AccountSQLDatabaseMixin as unknown as jest.Mock
  const actorMixinMock = ActorSQLDatabaseMixin as unknown as jest.Mock
  const fitnessSettingsMixinMock =
    FitnessSettingsSQLDatabaseMixin as unknown as jest.Mock
  const followerMixinMock = FollowerSQLDatabaseMixin as unknown as jest.Mock
  const likeMixinMock = LikeSQLDatabaseMixin as unknown as jest.Mock
  const mediaMixinMock = MediaSQLDatabaseMixin as unknown as jest.Mock
  const notificationMixinMock =
    NotificationSQLDatabaseMixin as unknown as jest.Mock
  const oauthMixinMock = OAuthSQLDatabaseMixin as unknown as jest.Mock
  const statusMixinMock = StatusSQLDatabaseMixin as unknown as jest.Mock
  const timelineMixinMock = TimelineSQLDatabaseMixin as unknown as jest.Mock

  const config = {
    client: 'better-sqlite3',
    useNullAsDefault: true,
    connection: {
      filename: ':memory:'
    }
  } as Knex.Config

  beforeEach(() => {
    jest.clearAllMocks()
  })

  const createComposedDatabase = () => {
    const knexDatabase = {
      migrate: {
        latest: jest.fn().mockResolvedValue(undefined)
      },
      destroy: jest.fn().mockResolvedValue(undefined)
    }

    const accountDatabase = {
      isAccountExists: jest.fn(),
      testPriority: 'account'
    }
    const actorDatabase = {
      getActorFromId: jest.fn(),
      testPriority: 'actor'
    }
    const fitnessSettingsDatabase = {
      createFitnessSettings: jest.fn()
    }
    const followerDatabase = {
      getFollowers: jest.fn()
    }
    const likeDatabase = {
      createLike: jest.fn()
    }
    const mediaDatabase = {
      createMedia: jest.fn()
    }
    const notificationDatabase = {
      createNotification: jest.fn()
    }
    const oauthDatabase = {
      createClient: jest.fn()
    }
    const statusDatabase = {
      getStatus: jest.fn()
    }
    const timelineDatabase = {
      getTimeline: jest.fn(),
      testPriority: 'timeline'
    }

    knexMock.mockReturnValue(knexDatabase)
    accountMixinMock.mockReturnValue(accountDatabase)
    actorMixinMock.mockReturnValue(actorDatabase)
    fitnessSettingsMixinMock.mockReturnValue(fitnessSettingsDatabase)
    followerMixinMock.mockReturnValue(followerDatabase)
    likeMixinMock.mockReturnValue(likeDatabase)
    mediaMixinMock.mockReturnValue(mediaDatabase)
    notificationMixinMock.mockReturnValue(notificationDatabase)
    oauthMixinMock.mockReturnValue(oauthDatabase)
    statusMixinMock.mockReturnValue(statusDatabase)
    timelineMixinMock.mockReturnValue(timelineDatabase)

    const database = getSQLDatabase(config)

    return {
      accountDatabase,
      actorDatabase,
      database,
      followerDatabase,
      fitnessSettingsDatabase,
      knexDatabase,
      likeDatabase,
      mediaDatabase,
      notificationDatabase,
      oauthDatabase,
      statusDatabase,
      timelineDatabase
    }
  }

  it('wires mixin dependencies correctly', () => {
    const {
      accountDatabase,
      actorDatabase,
      knexDatabase,
      likeDatabase,
      mediaDatabase,
      statusDatabase
    } = createComposedDatabase()

    expect(knexMock).toHaveBeenCalledWith(config)
    expect(accountMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(actorMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(fitnessSettingsMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(followerMixinMock).toHaveBeenCalledWith(knexDatabase, actorDatabase)
    expect(likeMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(mediaMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(notificationMixinMock).toHaveBeenCalledWith(knexDatabase)
    expect(oauthMixinMock).toHaveBeenCalledWith(
      knexDatabase,
      accountDatabase,
      actorDatabase
    )
    expect(statusMixinMock).toHaveBeenCalledWith(
      knexDatabase,
      actorDatabase,
      likeDatabase,
      mediaDatabase
    )
    expect(timelineMixinMock).toHaveBeenCalledWith(knexDatabase, statusDatabase)
  })

  it('exposes methods from all composed mixins', () => {
    const {
      accountDatabase,
      actorDatabase,
      database,
      followerDatabase,
      fitnessSettingsDatabase,
      likeDatabase,
      mediaDatabase,
      notificationDatabase,
      oauthDatabase,
      statusDatabase,
      timelineDatabase
    } = createComposedDatabase()

    expect(database.isAccountExists).toBe(accountDatabase.isAccountExists)
    expect(database.getActorFromId).toBe(actorDatabase.getActorFromId)
    expect(database.createFitnessSettings).toBe(
      fitnessSettingsDatabase.createFitnessSettings
    )
    expect(database.getFollowers).toBe(followerDatabase.getFollowers)
    expect(database.createLike).toBe(likeDatabase.createLike)
    expect(database.createMedia).toBe(mediaDatabase.createMedia)
    expect(database.createNotification).toBe(
      notificationDatabase.createNotification
    )
    expect(database.createClient).toBe(oauthDatabase.createClient)
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
