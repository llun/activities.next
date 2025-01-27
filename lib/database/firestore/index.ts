import { Firestore } from '@google-cloud/firestore'
import omit from 'lodash/omit'

import { FirestoreConfig } from '@/lib/database/firestore'
import { AccountFirestoreDatabaseMixin } from '@/lib/database/firestore/account'
import { ActorFirestoreDatabaseMixin } from '@/lib/database/firestore/actor'
import { FollowerFirestoreDatabaseMixin } from '@/lib/database/firestore/follow'
import { LikeFirestoreDatabaseMixin } from '@/lib/database/firestore/like'
import { MediaFirestoreDatabaseMixin } from '@/lib/database/firestore/media'
import { OAuthFirestoreDatabaseMixin } from '@/lib/database/firestore/oauth'
import { StatusFirestoreDatabaseMixin } from '@/lib/database/firestore/status'
import { Database } from '@/lib/database/types'
import { AccountDatabase } from '@/lib/database/types/account'
import { ActorDatabase } from '@/lib/database/types/actor'
import { FollowDatabase } from '@/lib/database/types/follow'
import { LikeDatabase } from '@/lib/database/types/like'
import { MediaDatabase } from '@/lib/database/types/media'
import { OAuthDatabase } from '@/lib/database/types/oauth'
import { StatusDatabase } from '@/lib/database/types/status'

export const getFirestoreDatabase = (
  config: FirestoreConfig
): AccountDatabase &
  ActorDatabase &
  FollowDatabase &
  LikeDatabase &
  MediaDatabase &
  OAuthDatabase &
  StatusDatabase => {
  const firestore = (function () {
    if (process.env.FIREBASE_PRIVATE_KEY && config.credentials) {
      config.credentials.private_key = process.env.FIREBASE_PRIVATE_KEY
    }
    if (config.credentials) {
      return new Firestore(omit(config, ['apiKey']))
    } else {
      return new Firestore(config)
    }
  })()

  const accountDatabase = AccountFirestoreDatabaseMixin(firestore)
  const actorDatabase = ActorFirestoreDatabaseMixin(firestore, accountDatabase)
  const followDatabase = FollowerFirestoreDatabaseMixin(
    firestore,
    actorDatabase
  )
  const likeDatabase = LikeFirestoreDatabaseMixin(firestore)
  const mediaDatabase = MediaFirestoreDatabaseMixin(firestore)
  const oauthDatabase = OAuthFirestoreDatabaseMixin(
    firestore,
    actorDatabase,
    accountDatabase
  )
  const statusDatabase = StatusFirestoreDatabaseMixin(
    firestore,
    actorDatabase,
    likeDatabase,
    mediaDatabase
  )

  return {
    ...accountDatabase,
    ...actorDatabase,
    ...followDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...oauthDatabase,
    ...statusDatabase
  }
}
