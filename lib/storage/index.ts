import memoize from 'lodash/memoize'

import { getConfig } from '../config'
import { FirebaseStorage } from './firebase'
import { Sqlite3Storage } from './sqlite3'
import { Storage } from './types'

export const getStorage = memoize(async (): Promise<Storage | null> => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
      return new Sqlite3Storage(config.database)
    case 'firebase':
      return new FirebaseStorage(config.database)
    default:
      return null
  }
})
