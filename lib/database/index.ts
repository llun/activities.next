import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { KnexBaseDatabase } from '@/lib/config/database'
import { FirestoreStorage } from '@/lib/database/firestore'
import { getSQLDatabase } from '@/lib/database/sql'
import { Storage } from '@/lib/database/types'

export const PER_PAGE_LIMIT = 30

export const getDatabase = memoize((): Storage | null => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
    case 'knex':
    case 'sql': {
      return getSQLDatabase(config.database as KnexBaseDatabase)
    }
    case 'firebase':
    case 'firestore':
      return new FirestoreStorage(config.database)
    default:
      return null
  }
})
