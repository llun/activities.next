import { trace } from '@opentelemetry/api'

import { VERSION } from '@/lib/constants'
import { logger } from '@/lib/utils/logger'

export const TRACE_APPLICATION_SCOPE = 'activities.next'
export const TRACE_APPLICATION_VERSION = VERSION

export interface Data {
  [key: string]: string | boolean | number | undefined
}

export const getSpan = (op: string, name: string, data: Data = {}) => {
  const tracer = trace.getTracer(
    TRACE_APPLICATION_SCOPE,
    TRACE_APPLICATION_VERSION
  )
  const span = tracer.startSpan(`${op}.${name}`, { attributes: data })
  return span
}

export const getTracer = () =>
  trace.getTracer(TRACE_APPLICATION_SCOPE, TRACE_APPLICATION_VERSION)

const AsyncFunction = async function () {}.constructor
type AsyncFunction = typeof AsyncFunction

export function Trace(op: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value as AsyncFunction
    if (original instanceof AsyncFunction) {
      return {
        ...descriptor,
        value: async function (...args: unknown[]) {
          const span = getSpan(op, propertyKey)
          logger.debug({ target: target.constructor.name, op, propertyKey })
          const value = await original.apply(this, args)
          span.end()
          return value
        }
      }
    }

    return {
      ...descriptor,
      value: function (...args: unknown[]) {
        const span = getSpan(op, propertyKey)
        logger.debug({ target: target.constructor.name, op, propertyKey })
        const value = original.apply(this, args)
        span.end()
        return value
      }
    }
  }
}
