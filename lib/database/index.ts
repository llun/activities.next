import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { KnexBaseDatabase } from '@/lib/config/database'
import { getFirestoreDatabase } from '@/lib/database/firestore'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

export const getDatabase = memoize((): Database | null => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
    case 'knex':
    case 'sql': {
      return getSQLDatabase(config.database as KnexBaseDatabase)
    }
    case 'firebase':
    case 'firestore':
      return getFirestoreDatabase(config.database)
    default:
      return null
  }
})
