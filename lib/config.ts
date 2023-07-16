import { Settings as FirestoreSetting } from '@google-cloud/firestore'
import fs from 'fs'
import type { Knex } from 'knex'
import memoize from 'lodash/memoize'
import path from 'path'

import { MediaStorageConfig } from './storage/types/media'

type KnexBaseDatabase = Knex.Config & { type: 'sqlite3' | 'sql' }
type FirebaseDatabase = FirestoreSetting & { type: 'firebase' | 'firestore' }

export interface Config {
  host: string
  database: KnexBaseDatabase | FirebaseDatabase
  allowEmails: string[]
  secretPhase: string
  allowMediaDomains?: string[]
  auth?: {
    enableStorageAdapter?: boolean
    github?: {
      id: string
      secret: string
    }
  }
  aws?: {
    key: string
    secret: string
    region: string
    functions: {
      sendMail?: {
        name: string
        qualifier?: string
      }
    }
  }
  mediaStorage?: MediaStorageConfig
}

export const getConfig = memoize((): Config => {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
  } catch {
    // Fall back to read config from environment variable
    const awsConfig =
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
        ? {
            key: process.env.AWS_ACCESS_KEY_ID,
            secret: process.env.AWS_SECRET_ACCESS_KEY,
            region: process.env.AWS_REGION,
            functions: {
              ...(process.env.AWS_LAMBDA_SENDMAIL_NAME
                ? {
                    sendMail: {
                      name: process.env.AWS_LAMBDA_SENDMAIL_NAME,
                      qualifier: process.env.AWS_LAMBDA_SENDMAIL_QUALIFIER
                    }
                  }
                : null)
            }
          }
        : undefined

    return {
      host: process.env.ACTIVITIES_HOST || '',
      database: JSON.parse(process.env.ACTIVITIES_DATABASE || '{}'),
      secretPhase: process.env.ACTIVITIES_SECRET_PHASE || '',
      allowEmails: JSON.parse(process.env.ACTIVITIES_ALLOW_EMAILS || '[]'),
      allowMediaDomains: JSON.parse(
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS || '[]'
      ),
      auth: JSON.parse(process.env.ACTIVITIES_AUTH || '{}'),
      ...awsConfig
    }
  }
})
