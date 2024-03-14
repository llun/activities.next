import fs from 'fs'
import memoize from 'lodash/memoize'
import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants'
import path from 'path'
import { z } from 'zod'

import { LambdaConfig } from '../services/email/lambda'
import { ResendConfig } from '../services/email/resend'
import { SMTPConfig } from '../services/email/smtp'
import { getAuthConfig } from './auth'
import {
  FirebaseDatabase,
  KnexBaseDatabase,
  getDatabaseConfig
} from './database'
import { InternalApiConfig, getInternalApiConfig } from './internalApi'
import { MediaStorageConfig, getMediaStorageConfig } from './mediaStorage'
import { OpenTelemetryConfig, getOtelConfig } from './opentelemetry'
import { RedisConfig, getRedisConfig } from './redis'
import { RequestConfig, getRequestConfig } from './request'

const Config = z.object({
  host: z.string(),
  serviceName: z.string().nullish(),
  serviceDescription: z.string().nullish(),
  languages: z.string().array().default(['en']),
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
  internalApi: InternalApiConfig.optional(),
  request: RequestConfig.optional()
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
      return null
    }

    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      return null
    }

    console.error('Invalid file config')
    console.error(nodeError.message)
    console.error(nodeError.stack)
    return null
  }
}

const getConfigFromEnvironment = () => {
  try {
    return Config.parse({
      host: process.env.ACTIVITIES_HOST || '',
      secretPhase: process.env.ACTIVITIES_SECRET_PHASE || '',
      allowEmails: JSON.parse(process.env.ACTIVITIES_ALLOW_EMAILS || '[]'),
      allowMediaDomains: JSON.parse(
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS || '[]'
      ),
      ...(process.env.ACTIVITIES_EMAIL
        ? { email: JSON.parse(process.env.ACTIVITIES_EMAIL) }
        : null),
      ...getAuthConfig(),
      ...getDatabaseConfig(),
      ...getMediaStorageConfig(),
      ...getRedisConfig(),
      ...getOtelConfig(),
      ...getInternalApiConfig(),
      ...getRequestConfig()
    })
  } catch (error) {
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      return null
    }

    const nodeErr = error as NodeJS.ErrnoException
    console.error('Invalid environment config')
    console.error(nodeErr.message)
    console.error(nodeErr.stack)
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
