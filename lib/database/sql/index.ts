import { Knex } from 'knex'

import { AccountSQLDatabaseMixin } from '@/lib/database/sql/account'
import { ActorSQLDatabaseMixin } from '@/lib/database/sql/actor'
import { AdminSQLDatabaseMixin } from '@/lib/database/sql/admin'
import { FitnessFileSQLDatabaseMixin } from '@/lib/database/sql/fitnessFile'
import { FitnessHeatmapSQLDatabaseMixin } from '@/lib/database/sql/fitnessHeatmap'
import { FitnessSettingsSQLDatabaseMixin } from '@/lib/database/sql/fitnessSettings'
import { FollowerSQLDatabaseMixin } from '@/lib/database/sql/follow'
import { LikeSQLDatabaseMixin } from '@/lib/database/sql/like'
import { MediaSQLDatabaseMixin } from '@/lib/database/sql/media'
import { NotificationSQLDatabaseMixin } from '@/lib/database/sql/notification'
import { OAuthSQLDatabaseMixin } from '@/lib/database/sql/oauth'
import { PushSubscriptionSQLDatabaseMixin } from '@/lib/database/sql/pushSubscription'
import { StatusSQLDatabaseMixin } from '@/lib/database/sql/status'
import { StravaArchiveImportSQLDatabaseMixin } from '@/lib/database/sql/stravaArchiveImport'
import { TimelineSQLDatabaseMixin } from '@/lib/database/sql/timeline'
import { Database } from '@/lib/database/types'

export const getSQLDatabase = (database: Knex): Database => {
  const accountDatabase = AccountSQLDatabaseMixin(database)
  const actorDatabase = ActorSQLDatabaseMixin(database)
  const adminDatabase = AdminSQLDatabaseMixin(database)
  const fitnessFileDatabase = FitnessFileSQLDatabaseMixin(database)
  const fitnessHeatmapDatabase = FitnessHeatmapSQLDatabaseMixin(database)
  const fitnessSettingsDatabase = FitnessSettingsSQLDatabaseMixin(database)
  const followerDatabase = FollowerSQLDatabaseMixin(database, actorDatabase)
  const likeDatabase = LikeSQLDatabaseMixin(database)
  const mediaDatabase = MediaSQLDatabaseMixin(database)
  const notificationDatabase = NotificationSQLDatabaseMixin(database)
  const pushSubscriptionDatabase = PushSubscriptionSQLDatabaseMixin(database)
  const oauthDatabase = OAuthSQLDatabaseMixin(database)
  const stravaArchiveImportDatabase =
    StravaArchiveImportSQLDatabaseMixin(database)
  const statusDatabase = StatusSQLDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    mediaDatabase
  )
  const timelineDatabase = TimelineSQLDatabaseMixin(database, statusDatabase)

  return {
    async migrate() {
      await database.migrate.latest({ disableTransactions: true })
    },

    async destroy() {
      await database.destroy()
    },

    ...accountDatabase,
    ...actorDatabase,
    ...adminDatabase,
    ...fitnessFileDatabase,
    ...fitnessHeatmapDatabase,
    ...fitnessSettingsDatabase,
    ...followerDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...notificationDatabase,
    ...pushSubscriptionDatabase,
    ...oauthDatabase,
    ...stravaArchiveImportDatabase,
    ...statusDatabase,

    ...timelineDatabase
  }
}
