import memoize from 'lodash/memoize'
import { Sqlite3Storage } from './sqlite3'
import { getConfig } from '../config'
import { Storage } from './types'

export const getStorage = memoize(async (): Promise<Storage | null> => {
  const config = getConfig()
  switch (config.database.type) {
    case 'sqlite3':
      return new Sqlite3Storage(config.database)
    default:
      return null
  }
})
