import { Firestore, Settings } from '@google-cloud/firestore'
import omit from 'lodash/omit'

import { AccountFirestoreDatabaseMixin } from '@/lib/database/firestore/account'
import { ActorFirestoreDatabaseMixin } from '@/lib/database/firestore/actor'
import { FollowerFirestoreDatabaseMixin } from '@/lib/database/firestore/follow'
import { LikeFirestoreDatabaseMixin } from '@/lib/database/firestore/like'
import { MediaFirestoreDatabaseMixin } from '@/lib/database/firestore/media'
import { OAuthFirestoreDatabaseMixin } from '@/lib/database/firestore/oauth'
import { StatusFirestoreDatabaseMixin } from '@/lib/database/firestore/status'
import { Database } from '@/lib/database/types'

import { TimelineFirestoreDatabaseMixin } from './timeline'

export interface FirestoreConfig extends Settings {
  type: 'firebase' | 'firestore'
}

export const getFirestoreDatabase = (config: FirestoreConfig): Database => {
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
  const timelineDatabase = TimelineFirestoreDatabaseMixin(
    firestore,
    statusDatabase
  )

  return {
    async migrate() {},
    async destroy() {
      await fetch(
        `http://127.0.0.1:8080/emulator/v1/projects/${config.projectId}/databases/(default)/documents`,
        {
          method: 'DELETE'
        }
      )
      await firestore.terminate()
    },
    ...accountDatabase,
    ...actorDatabase,
    ...followDatabase,
    ...likeDatabase,
    ...mediaDatabase,
    ...oauthDatabase,
    ...statusDatabase,
    ...timelineDatabase
  }
}
