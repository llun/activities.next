import * as Sentry from '@sentry/nextjs'
import { NextApiHandler } from 'next'

import { errorResponse } from './errors'
import { logger } from './logger'

export interface Data {
  [key: string]: string | boolean | number | undefined
}

export const getSpan = (op: string, name: string, data: Data = {}) => {
  return Sentry.getCurrentHub().getScope()?.getTransaction()?.startChild({
    op,
    description: name,
    data
  })
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
          span?.finish()
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
        span?.finish()
        return value
      }
    }
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function TraceSync(op: string, fn: Function) {
  return function (...args: unknown[]) {
    const span = getSpan(op, fn.name)
    logger.debug({ op, propertyKey: fn.name })
    const value = fn(...args)
    span?.finish()
    return value
  }
}

export function TraceAsync(op: string, fn: AsyncFunction) {
  return async function (...args: unknown[]) {
    const span = getSpan(op, fn.name)
    logger.debug({ op, propertyKey: fn.name })
    const value = await fn(...args)
    span?.finish()
    return value
  }
}

export const ApiTrace =
  (name: string, handle: NextApiHandler): NextApiHandler =>
  async (req, res) => {
    const span = getSpan('api', name, { method: req.method })
    try {
      await handle(req, res)
    } catch (e: any) {
      Sentry.captureException(e)
      return errorResponse(res, 500)
    }
    span?.finish()
  }
