import { FirestoreConfig } from '@/lib/config/database'
import { AccountFirestoreDatabaseMixin } from '@/lib/database/firestore/account'
import { ActorFirestoreDatabaseMixin } from '@/lib/database/firestore/actor'
import { FitnessSettingsFirestoreDatabaseMixin } from '@/lib/database/firestore/fitnessSettings'
import { FollowerFirestoreDatabaseMixin } from '@/lib/database/firestore/follow'
import { LikeFirestoreDatabaseMixin } from '@/lib/database/firestore/like'
import { MediaFirestoreDatabaseMixin } from '@/lib/database/firestore/media'
import { NotificationFirestoreDatabaseMixin } from '@/lib/database/firestore/notification'
import { OAuthFirestoreDatabaseMixin } from '@/lib/database/firestore/oauth'
import { StatusFirestoreDatabaseMixin } from '@/lib/database/firestore/status'
import { TimelineFirestoreDatabaseMixin } from '@/lib/database/firestore/timeline'
import { getFirestore } from '@/lib/database/firestore/utils'
import { Database } from '@/lib/database/types'

export const getFirestoreDatabase = (config: FirestoreConfig): Database => {
  const database = getFirestore(config)

  const accountDatabase = AccountFirestoreDatabaseMixin(database)
  const actorDatabase = ActorFirestoreDatabaseMixin(database)
  const fitnessSettingsDatabase =
    FitnessSettingsFirestoreDatabaseMixin(database)
  const followerDatabase = FollowerFirestoreDatabaseMixin(
    database,
    actorDatabase
  )
  const likeDatabase = LikeFirestoreDatabaseMixin(database)
  const mediaDatabase = MediaFirestoreDatabaseMixin(database)
  const notificationDatabase = NotificationFirestoreDatabaseMixin(database)
  const oauthDatabase = OAuthFirestoreDatabaseMixin(
    database,
    accountDatabase,
    actorDatabase
  )
  const statusDatabase = StatusFirestoreDatabaseMixin(
    database,
    actorDatabase,
    likeDatabase,
    mediaDatabase
  )
  const timelineDatabase = TimelineFirestoreDatabaseMixin(
    database,
    statusDatabase
  )

  return {
    async migrate() {
      // Firestore is schemaless, no migrations needed for basic setup
    },

    async destroy() {
      await database.terminate()
    },

    ...accountDatabase,
    ...actorDatabase,
    ...fitnessSettingsDatabase,
    ...followerDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...notificationDatabase,
    ...oauthDatabase,
    ...statusDatabase,
    ...timelineDatabase
  } as Database
}
