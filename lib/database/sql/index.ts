import knex, { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { LikeSQLDatabaseMixin } from '@/lib/database/sql/like'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { NotificationSQLDatabaseMixin } from '@/lib/database/sql/notification'
import { OAuthSQLDatabaseMixin } from '@/lib/database/sql/oauth'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { Database } from '@/lib/database/types'

export const getSQLDatabase = (config: Knex.Config): Database => {
  const database = knex(config)

  const accountDatabase = AccountSQLDatabaseMixin(database)
  const actorDatabase = ActorSQLDatabaseMixin(database)
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const likeDatabase = LikeSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const notificationDatabase = NotificationSQLDatabaseMixin(database)
  const oauthDatabase = OAuthSQLDatabaseMixin(
    database,
    accountDatabase,
    actorDatabase
  )
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    mediaDatabase
  )
  const timelineDatabase = TimelineSQLDatabaseMixin(database, statusDatabase)

  return {
    async migrate() {
      await database.migrate.latest()
    },

    async destroy() {
      await database.destroy()
    },

    ...accountDatabase,
    ...actorDatabase,
    ...followerDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...notificationDatabase,
    ...oauthDatabase,
    ...statusDatabase,
    ...timelineDatabase
  }
}
