import pino, { Level, LoggerOptions } from 'pino'

import { VERSION } from '@/lib/utils/version'

export const levelToSeverity: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL'
}

export const getLoggerOptions = (): LoggerOptions => {
  // Detect if running in GCP Cloud Run or other production environments
  const isGCP = Boolean(
    process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT
  )
  const isDevelopment = process.env.NODE_ENV === 'development'

  return {
    enabled: true,
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      serviceContext: {
        service: process.env.K_SERVICE || 'activities.next',
        version: process.env.K_REVISION || VERSION
      }
    },
    messageKey: 'message',
    // Use pretty printing for local development, structured JSON for GCP
    transport:
      !isGCP && isDevelopment
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname,serviceContext'
            }
          }
        : undefined,
    formatters: {
      level(label: string) {
        // Only use GCP format when running in GCP
        if (!isGCP) {
          return { level: label }
        }
        const pinoLevel = label as Level
        const severity = levelToSeverity[label] ?? 'INFO'
        const typeProp =
          pinoLevel === 'error' || pinoLevel === 'fatal'
            ? {
                '@type':
                  'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent'
              }
            : {}
        return { severity, ...typeProp }
      },

      log(object) {
        const logObject = object as {
          err?: Error
          error?: unknown
          stack?: string
        }
        const errStack =
          logObject.err?.stack ??
          (logObject.error instanceof Error
            ? logObject.error.stack
            : undefined) ??
          logObject.stack
        const stackProp = errStack ? { stack_trace: errStack } : {}
        return { ...object, ...stackProp }
      }
    }
  }
}

const logger = pino(getLoggerOptions())

export { logger }
