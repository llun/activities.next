import { trace } from '@opentelemetry/api'
import { NextApiHandler } from 'next'

import { logger } from './logger'
import { errorResponse } from './response'

export const TRACE_APPLICATION_SCOPE = 'activities.next'
export const TRACE_APPLICATION_VERSION = '0.1.0'

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

const AsyncFunction = async function () {}.constructor // eslint-disable-line @typescript-eslint/no-empty-function
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
export function TraceSync(op: string, fn: Function) {
  return function (...args: unknown[]) {
    const span = getSpan(op, fn.name)
    logger.debug({ op, propertyKey: fn.name })
    const value = fn(...args)
    span.end()
    return value
  }
}

export function TraceAsync(op: string, fn: AsyncFunction) {
  return async function (...args: unknown[]) {
    const span = getSpan(op, fn.name)
    logger.debug({ op, propertyKey: fn.name })
    const value = await fn(...args)
    span.end()
    return value
  }
}

export const ApiTrace =
  (name: string, handle: NextApiHandler): NextApiHandler =>
  async (req, res) => {
    const span = getSpan('api', name, { method: req.method })
    try {
      await handle(req, res)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      span.recordException(e)
      return errorResponse(res, 500)
    }
    span.end()
  }
