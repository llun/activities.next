import { Settings as FirestoreSetting } from '@google-cloud/firestore'
import fs from 'fs'
import type { Knex } from 'knex'
import memoize from 'lodash/memoize'
import path from 'path'

import { LambdaConfig } from './services/email/lambda'
import { ResendConfig } from './services/email/resend'
import { SMTPConfig } from './services/email/smtp'
import { MediaStorageConfig } from './storage/types/media'

type KnexBaseDatabase = Knex.Config & { type: 'sqlite3' | 'sql' | 'knex' }
type FirebaseDatabase = FirestoreSetting & { type: 'firebase' | 'firestore' }

type OpenTelemetryProtocol = 'grpc' | 'http/protobuf' | 'http/json'

interface OpenTelemetryConfig {
  endpoint: string
  protocol?: OpenTelemetryProtocol
  headers?: string
}

export interface Config {
  serviceName?: string
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
  email?: SMTPConfig | LambdaConfig | ResendConfig
  mediaStorage?: MediaStorageConfig
  redis?: { url: string; tls?: boolean }
  openTelemetry?: OpenTelemetryConfig
}

export const getConfig = memoize((): Config => {
  try {
    return JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'config.json'), 'utf-8')
    )
  } catch {
    return {
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
      ...(process.env.ACTIVITIES_REDIS_URL
        ? {
            redis: {
              url: process.env.ACTIVITIES_REDIS_URL,
              tls: Boolean(process.env.ACTIVITIES_REDIS_TLS)
            }
          }
        : null),
      ...(process.env.OTEL_EXPORTER_OTLP_ENDPOINT
        ? {
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
        : null)
    }
  }
})
