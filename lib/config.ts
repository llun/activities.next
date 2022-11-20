import fs from 'fs'
import path from 'path'
import memoize from 'lodash/memoize'
import type { Knex } from 'knex'
import { FirebaseOptions } from 'firebase/app'

type KnexBaseDatabase = Knex.Config & { type: 'sqlite3' }
type FirebaseDatabase = FirebaseOptions & { type: 'firebase' }

export interface Config {
  host: string
  database: KnexBaseDatabase | FirebaseDatabase
  allowEmails: string[]
  secretPhase: string
  auth?: {
    github?: {
      id: string
      secret: string
    }
  }
}

export const getConfig = memoize((): Config => {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
  } catch {
    // Fall back to read config from environment variable
    return {
      host: process.env.ACTIVITIES_HOST || '',
      database: JSON.parse(process.env.ACTIVITIES_DATABASE || '{}'),
      allowEmails: JSON.parse(process.env.ACTIVITIES_ALLOW_EMAILS || '[]'),
      secretPhase: process.env.ACTIVITIES_SECRET_PHASE || '',
      auth: JSON.parse(process.env.ACTIVITIES_AUTH || '{}')
    }
  }
})
