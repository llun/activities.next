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

const logger = pino({
  enabled: process.env.NODE_ENV === 'production',
  base: {
    serviceContext: {
      service: 'activities.next',
      version: VERSION
    }
  },
  messageKey: 'message',
  formatters: {
    level(label: string) {
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
