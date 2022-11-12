import fs from 'fs'
import path from 'path'
import memoize from 'lodash/memoize'
import type { Knex } from 'knex'

export interface Config {
  host: string
  database: Knex.Config & { type: 'sqlite3' }
  auth?: {
    github?: {
      id: string
      secret: string
    }
  }
}

export const getConfig = memoize((): Config => {
  return JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
  )
})
