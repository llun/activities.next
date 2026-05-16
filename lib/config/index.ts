import { Knex } from 'knex'
import memoize from 'lodash/memoize'
import { PHASE_PRODUCTION_BUILD } from 'next/dist/shared/lib/constants'
import { z } from 'zod'

import { LambdaConfig } from '@/lib/services/email/lambda'
import { ResendConfig } from '@/lib/services/email/resend'
import { SESConfig } from '@/lib/services/email/ses'
import { SMTPConfig } from '@/lib/services/email/smtp'
import { logger } from '@/lib/utils/logger'

import { AuthConfig, getAuthConfig } from './auth'
import { getDatabaseConfig } from './database'
import { getEmailConfig } from './email'
import { FitnessStorageConfig, getFitnessStorageConfig } from './fitnessStorage'
import { getHostConfigFromEnvironment } from './host'
import { MediaStorageConfig, getMediaStorageConfig } from './mediaStorage'
import { OpenTelemetryConfig, getOtelConfig } from './opentelemetry'
import { PushConfig, getPushConfig } from './push'
import { QueueConfig, getQueueConfig } from './queue'
import { RequestConfig, getRequestConfig } from './request'

const FederationMode = z.enum(['open', 'allowlist'])
const MINIMUM_PRODUCTION_SECRET_LENGTH = 32

const Config = z.object({
  host: z.string(),
  serviceName: z.string().nullish(),
  serviceDescription: z.string().nullish(),
  languages: z.string().array().default(['en']),
  database: z.custom<Knex.Config>(),
  queue: QueueConfig.optional(),
  push: PushConfig.optional(),
  allowEmails: z.string().array(),
  secretPhase: z.string(),
  allowMediaDomains: z.string().array().optional(),
  allowActorDomains: z.string().array().optional(),
  trustedHosts: z.string().array().optional(),
  trustProxyIpHeaders: z.boolean().default(false),
  federationMode: FederationMode.default('open'),
  auth: AuthConfig.optional(),
  email: z
    .union([SMTPConfig, LambdaConfig, ResendConfig, SESConfig])
    .optional(),
  mediaStorage: MediaStorageConfig.optional(),
  fitnessStorage: FitnessStorageConfig.optional(),
  openTelemetry: OpenTelemetryConfig.optional(),
  request: RequestConfig.optional()
})
export type Config = z.infer<typeof Config>

const shouldValidateProductionRuntimeSecret = () =>
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD

const validateProductionRuntimeSecret = (config: Config) => {
  if (!shouldValidateProductionRuntimeSecret()) return
  if (config.secretPhase.trim().length >= MINIMUM_PRODUCTION_SECRET_LENGTH) {
    return
  }

  throw new Error(
    'ACTIVITIES_SECRET_PHASE must be at least 32 characters in production runtime'
  )
}

const getConfigFromEnvironment = () => {
  let config: Config

  try {
    const hostConfig = getHostConfigFromEnvironment({
      onInvalidList: 'throw'
    })

    config = Config.parse({
      host: hostConfig.host,
      secretPhase: process.env.ACTIVITIES_SECRET_PHASE || '',
      allowEmails: JSON.parse(process.env.ACTIVITIES_ALLOW_EMAILS || '[]'),
      allowMediaDomains: JSON.parse(
        process.env.ACTIVITIES_ALLOW_MEDIA_DOMAINS || '[]'
      ),
      allowActorDomains: hostConfig.allowActorDomains,
      trustedHosts: hostConfig.trustedHosts,
      trustProxyIpHeaders:
        process.env.ACTIVITIES_TRUST_PROXY_IP_HEADERS === 'true',
      federationMode: process.env.ACTIVITIES_FEDERATION_MODE || 'open',
      ...getEmailConfig(),
      ...getAuthConfig(),
      ...getDatabaseConfig(),
      ...getMediaStorageConfig(),
      ...getFitnessStorageConfig(),
      ...getOtelConfig(),
      ...getRequestConfig(),
      ...getQueueConfig(),
      ...getPushConfig()
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

  return config
}

export const getConfig = memoize((): Config => {
  const environmentConfig = getConfigFromEnvironment()
  if (environmentConfig) {
    validateProductionRuntimeSecret(environmentConfig)
    return environmentConfig
  }

  throw new Error('Fail to read Activities.next config')
})

export const getBaseURL = (): string => {
  const config = getConfig()
  if (config.host.includes('://')) return config.host
  const scheme =
    process.env.ACTIVITIES_INSECURE_AUTH === 'true' ? 'http' : 'https'
  return `${scheme}://${config.host}`
}
