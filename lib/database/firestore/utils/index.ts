import { Firestore, Settings } from '@google-cloud/firestore'
import memoize from 'lodash/memoize'

import { FirestoreConfig } from '@/lib/config/database'

export const getFirestore = memoize((config: FirestoreConfig): Firestore => {
  const settings: Settings = {
    projectId: config.projectId
  }
  if (config.host) {
    settings.host = config.host
    settings.port = config.port
    settings.ssl = config.ssl
  }
  return new Firestore(settings)
})

export const getCompatibleTime = (time: any): number => {
  if (typeof time === 'number') return time
  if (time instanceof Date) return time.getTime()
  if (time && typeof time.toMillis === 'function') return time.toMillis()
  return 0
}
