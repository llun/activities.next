import knex, { Knex } from 'knex'
import memoize from 'lodash/memoize'

import { getConfig } from '@/lib/config'
import { getSQLDatabase } from '@/lib/database/sql'
import { Database } from '@/lib/database/types'

let sharedKnex: Knex | null = null

export const getKnex = (): Knex => {
  if (sharedKnex) return sharedKnex
  // Force initialization of the database (and shared knex) if not done yet
  getDatabase()
  if (!sharedKnex) {
    const config = getConfig()
    sharedKnex = knex(config.database)
  }
  return sharedKnex
}

export const getDatabase = memoize((): Database | null => {
  const config = getConfig()
  const db = knex(config.database)
  sharedKnex = db
  return getSQLDatabase(db)
})
