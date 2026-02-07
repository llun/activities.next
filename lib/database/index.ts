import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getFirestoreDatabase } from '@/lib/database/firestore'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

export const getDatabase = memoize((): Database | null => {
  const config = getConfig()
  if (config.database.client === 'firestore') {
    return getFirestoreDatabase(config.database)
  }
  return getSQLDatabase(config.database)
})
