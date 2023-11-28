import fs from 'fs'
import memoize from 'lodash/memoize'
import path from 'path'
import { z } from 'zod'

import { LambdaConfig } from '../services/email/lambda'
import { ResendConfig } from '../services/email/resend'
import { SMTPConfig } from '../services/email/smtp'
import { FirebaseDatabase, KnexBaseDatabase } from './database'
import { InternalApiConfig, getInternalApiConfig } from './internalApi'
import { MediaStorageConfig, getMediaStorageConfig } from './mediaStorage'
import { OpenTelemetryConfig, getOtelConfig } from './opentelemetry'
import { RedisConfig, getRedisConfig } from './redis'

const Config = z.object({
  serviceName: z.string().optional(),
  host: z.string(),
  database: z.union([KnexBaseDatabase, FirebaseDatabase]),
  allowEmails: z.string().array(),
  secretPhase: z.string(),
  allowMediaDomains: z.string().array().optional(),
  auth: z
    .object({
      enableStorageAdapter: z.boolean().optional(),
      github: z.object({ id: z.string(), secret: z.string() }).optional()
    })
    .optional(),
  email: z.union([SMTPConfig, LambdaConfig, ResendConfig]).optional(),
  mediaStorage: MediaStorageConfig.optional(),
  redis: RedisConfig.optional(),
  openTelemetry: OpenTelemetryConfig.optional(),
  internalApi: InternalApiConfig.optional()
})
export type Config = z.infer<typeof Config>

const getConfigFromFile = () => {
  try {
    return Config.parse(
      JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
      )
    )
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      console.error('Config file is not exists')
      return null
    }

    console.error('Invalid file config')
    console.error((error as Error).message)
    return null
  }
}

const getConfigFromEnvironment = () => {
  try {
    return Config.parse({
      host: process.env.ACTIVITIES_HOST || '',
      database: JSON.parse(process.env.ACTIVITIES_DATABASE || '{}'),
      secretPhase: process.env.ACTIVITIES_SECRET_PHASE || '',
      allowEmails: JSON.parse(process.env.ACTIVITIES_ALLOW_EMAILS || '[]'),
      allowMediaDomains: JSON.parse(
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS || '[]'
      ),
      auth: JSON.parse(process.env.ACTIVITIES_AUTH || '{}'),
      ...(process.env.ACTIVITIES_EMAIL
        ? { email: JSON.parse(process.env.ACTIVITIES_EMAIL) }
        : null),
      ...getMediaStorageConfig(),
      ...getRedisConfig(),
      ...getOtelConfig(),
      ...getInternalApiConfig()
    })
  } catch (error) {
    console.error('Invalid environment config')
    console.error((error as Error).message)
    return null
  }
}

export const getConfig = memoize((): Config => {
  const fileConfig = getConfigFromFile()
  if (fileConfig) return fileConfig

  const environmentConfig = getConfigFromEnvironment()
  if (environmentConfig) return environmentConfig

  throw new Error('Fail to read Activities.next config')
})
