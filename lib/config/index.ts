import fs from 'fs'
import { Knex } from 'knex'
import memoize from 'lodash/memoize'
import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants'
import path from 'path'
import { z } from 'zod'

import { LambdaConfig } from '../services/email/lambda'
import { ResendConfig } from '../services/email/resend'
import { SMTPConfig } from '../services/email/smtp'
import { logger } from '../utils/logger'
import { AuthConfig, getAuthConfig } from './auth'
import { getDatabaseConfig } from './database'
import { InternalApiConfig, getInternalApiConfig } from './internalApi'
import { MediaStorageConfig, getMediaStorageConfig } from './mediaStorage'
import { OpenTelemetryConfig, getOtelConfig } from './opentelemetry'
import { QueueConfig, getQueueConfig } from './queue'
import { RequestConfig, getRequestConfig } from './request'

const Config = z.object({
  host: z.string(),
  serviceName: z.string().nullish(),
  serviceDescription: z.string().nullish(),
  languages: z.string().array().default(['en']),
  database: z.custom<Knex.Config>(),
  queue: QueueConfig.optional(),
  allowEmails: z.string().array(),
  secretPhase: z.string(),
  allowMediaDomains: z.string().array().optional(),
  allowActorDomains: z.string().array().optional(),
  auth: AuthConfig.optional(),
  email: z.union([SMTPConfig, LambdaConfig, ResendConfig]).optional(),
  mediaStorage: MediaStorageConfig.optional(),
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

    logger.error('Invalid file config')
    logger.error(nodeError)
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
      allowActorDomains: JSON.parse(
        process.env.ACTIVITIES_ALLOW_ACTOR_DOMAINS || '[]'
      ),
      ...(process.env.ACTIVITIES_EMAIL
        ? { email: JSON.parse(process.env.ACTIVITIES_EMAIL) }
        : null),
      ...getAuthConfig(),
      ...getDatabaseConfig(),
      ...getMediaStorageConfig(),
      ...getOtelConfig(),
      ...getInternalApiConfig(),
      ...getRequestConfig(),
      ...getQueueConfig()
    })
  } catch (error) {
    if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) {
      return null
    }

    const nodeErr = error as NodeJS.ErrnoException
    logger.error('Invalid environment config')
    logger.error(nodeErr)
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
