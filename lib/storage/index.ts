import memoize from 'lodash/memoize'

import { KnexBaseDatabase, getConfig } from '../config'
import { FirestoreStorage } from './firestore'
import { SqlStorage } from './sql'
import { Storage } from './types'

export const PER_PAGE_LIMIT = 30

export const getStorage = memoize(async (): Promise<Storage | null> => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
    case 'knex':
    case 'sql':
      return new SqlStorage(config.database as KnexBaseDatabase)
    case 'firebase':
    case 'firestore':
      return new FirestoreStorage(config.database)
    default:
      return null
  }
})
