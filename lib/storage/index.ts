import memoize from 'lodash/memoize'

import { getConfig } from '../config'
import { FirestoreStorage } from './firestore'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

export const PER_PAGE_LIMIT = 30

export const getStorage = memoize(async (): Promise<Storage | null> => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
      return new Sqlite3Storage(config.database)
    case 'firebase':
    case 'firestore':
      return new FirestoreStorage(config.database)
    default:
      return null
  }
})
