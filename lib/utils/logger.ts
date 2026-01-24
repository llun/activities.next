import pino, { Level } from 'pino'

import { VERSION } from '../constants'

const levelToSeverity: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL'
}

// Detect if running in GCP Cloud Run or other production environments
const isGCP = Boolean(process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT)
const isDevelopment = process.env.NODE_ENV === 'development'

const logger = pino({
  enabled: true,
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    serviceContext: {
      service: 'activities.next',
      version: VERSION
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
      const logObject = object as { err?: Error }
      const stackTrace = logObject.err?.stack
      const stackProp = stackTrace ? { stack_trace: stackTrace } : {}
      return { ...object, ...stackProp }
    }
  }
})

export { logger }
