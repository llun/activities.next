import knex, { Knex } from 'knex'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

interface DatabaseInstance {
  database: Database
  knex: Knex
}

const getDatabaseInstance = memoize((): DatabaseInstance | null => {
  const config = getConfig()
  const db = knex(config.database)
  return { database: getSQLDatabase(db), knex: db }
})

export const getKnex = (): Knex => {
  const instance = getDatabaseInstance()
  if (!instance) {
    throw new Error('Database not initialized')
  }
  return instance.knex
}

export const getDatabase = (): Database | null => {
  return getDatabaseInstance()?.database ?? null
}
