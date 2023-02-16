import * as Sentry from '@sentry/nextjs'

import { logger } from './logger'

interface Data {
  [key: string]: string | boolean | number | undefined
}

export const getDatabaseSpan = (
  databaseMethod: string,
  collection: string,
  data: Data = {}
) => {
  return Sentry.getCurrentHub()
    .getScope()
    ?.getTransaction()
    ?.startChild({
      op: 'db',
      description: databaseMethod,
      tags: {
        table: collection
      },
      data
    })
}

export const getSpan = (op: string, name: string, data: Data = {}) => {
  return Sentry.getCurrentHub().getScope()?.getTransaction()?.startChild({
    op,
    description: name,
    data
  })
}

const AsyncFunction = async function () {}.constructor // eslint-disable-line @typescript-eslint/no-empty-function

export function Trace(op: string) {
  return function (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const original = descriptor.value as typeof AsyncFunction
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
