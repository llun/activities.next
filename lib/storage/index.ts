import { Sqlite3Storage } from './sqlite3'
import { getConfig } from '../config'
export const getStorage = async () => {
  const config = await getConfig()
  switch (config.database.type) {
    case 'sqlite3':
      return new Sqlite3Storage(config.database)
    default:
      return null
  }
}
