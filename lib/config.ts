import { Settings as FirestoreSetting } from '@google-cloud/firestore'
import fs from 'fs'
import type { Knex } from 'knex'
import memoize from 'lodash/memoize'
import path from 'path'
import { z } from 'zod'

import { LambdaConfig } from './services/email/lambda'
import { ResendConfig } from './services/email/resend'
import { SMTPConfig } from './services/email/smtp'
import { MediaStorageConfig } from './storage/types/media'

const KnexBaseDatabase = z.object({
  type: z.union([z.literal('sqlite'), z.literal('sql'), z.literal('knex')])
})
type KnexBaseDatabase = Knex.Config & z.infer<typeof KnexBaseDatabase>
const FirebaseDatabase = z.object({
  type: z.union([z.literal('firebase'), z.literal('firestore')])
})
type FirebaseDatabase = FirestoreSetting & z.infer<typeof FirebaseDatabase>

const OpenTelemetryProtocol = z.union([
  z.literal('grpc'),
  z.literal('http/protobuf'),
  z.literal('http/json')
])
type OpenTelemetryProtocol = z.infer<typeof OpenTelemetryProtocol>

const OpenTelemetryConfig = z.object({
  endpoint: z.string(),
  protocol: OpenTelemetryProtocol.optional(),
  headers: z.string().optional()
})
type OpenTelemetryConfig = z.infer<typeof OpenTelemetryConfig>

const InternalApiConfig = z.object({
  sharedKey: z.string()
})
type InternalApiConfig = z.infer<typeof InternalApiConfig>

const RedisConfig = z.object({
  url: z.string(),
  tls: z.boolean().optional()
})
type RedisConfig = z.infer<typeof RedisConfig>

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

const matcher = (prefix: string) =>
  Object.keys(process.env).some((key: string) => key.startsWith(prefix))

const getOtelConfig = (): { openTelemetry: OpenTelemetryConfig } | null => {
  const hasEnvironmentOtel = matcher('OTEL_EXPORTER_')
  if (!hasEnvironmentOtel) return null
  return {
    openTelemetry: {
      endpoint: process.env.OTEL_EXPORTER_OLTP_ENDPOINT as string,
      ...(process.env.OTEL_EXPORTER_OLTP_PROTOCOL
        ? {
            protocol: process.env
              .OTEL_EXPORTER_OLTP_PROTOCOL as OpenTelemetryProtocol
          }
        : null),
      ...(process.env.OTEL_EXPORTER_OLTP_HEADERS
        ? { headers: process.env.OTEL_EXPORTER_OLTP_HEADERS }
        : null)
    }
  }
}

const getInternalApiConfig = (): { internalApi: InternalApiConfig } | null => {
  const hasEnvironmentInternalApi = matcher('ACTIVITIES_INTERNAL_API_')
  if (!hasEnvironmentInternalApi) return null
  return {
    internalApi: {
      sharedKey: process.env.ACTIVITIES_INTERNAL_SHARED_KEY as string
    }
  }
}

const getRedisConfig = (): { redis: RedisConfig } | null => {
  const hasEnvironmentRedis = matcher('ACTIVITIES_REDIS_')
  if (!hasEnvironmentRedis) return null
  return {
    redis: {
      url: process.env.ACTIVITIES_REDIS_URL as string,
      tls: Boolean(process.env.ACTIVITIES_REDIS_TLS)
    }
  }
}

const getConfigFromFile = () => {
  try {
    return Config.parse(
      JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
      )
    )
  } catch (error) {
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
      ...getRedisConfig(),
      ...getOtelConfig(),
      ...getInternalApiConfig()
    })
  } catch (error) {
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
