import fs from 'fs/promises'
import memoize from 'lodash/memoize'
import type { Knex } from 'knex'

export interface Config {
  host: string
  database: Knex.Config & { type: 'knex' }
}

export const getConfig = memoize(async (): Promise<Config> => {
  return JSON.parse(await fs.readFile('../config.json', 'utf-8'))
})
