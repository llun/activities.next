import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { KnexBaseDatabase } from '@/lib/config/database'
import { FirestoreStorage } from '@/lib/storage/firestore'
import { getSQLStorage } from '@/lib/storage/sql'
import { Storage } from '@/lib/storage/types'

export const PER_PAGE_LIMIT = 30

export const getStorage = memoize((): Storage | null => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
    case 'knex':
    case 'sql': {
      return getSQLStorage(config.database as KnexBaseDatabase)
    }
    case 'firebase':
    case 'firestore':
      return new FirestoreStorage(config.database)
    default:
      return null
  }
})
