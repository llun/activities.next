import memoize from 'lodash/memoize'

import { getConfig } from '../config'
import { KnexBaseDatabase } from '../config/database'
import { FirestoreStorage } from './firestore'
import { getPGStorage } from './pg'
import { SqlStorage } from './sql'
import { Storage } from './types'

export const PER_PAGE_LIMIT = 30

export const getStorage = memoize((): Storage | null => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
    case 'knex':
    case 'sql': {
      if (config.database.client === 'pg') {
        return getPGStorage(config.database as KnexBaseDatabase)
      }
      return new SqlStorage(config.database as KnexBaseDatabase)
    }
    case 'firebase':
    case 'firestore':
      return new FirestoreStorage(config.database)
    default:
      return null
  }
})
