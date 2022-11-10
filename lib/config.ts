import fs from 'fs/promises'
import path from 'path'
import memoize from 'lodash/memoize'
import type { Knex } from 'knex'

export interface Config {
  host: string
  database: Knex.Config & { type: 'sqlite3' }
}

export const getConfig = memoize(async (): Promise<Config> => {
  return JSON.parse(
    await fs.readFile(path.resolve(process.cwd(), 'config.json'), 'utf-8')
  )
})
