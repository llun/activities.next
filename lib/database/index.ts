import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

export const getDatabase = memoize((): Database | null => {
  const config = getConfig()
  return getSQLDatabase(config.database)
})
