import * as Sentry from '@sentry/node'

interface Data {
  [key: string]: string | boolean | number | undefined
}

// TODO: Convert this to decorator
export const getDatabaseSpan = (
  databaseMethod: string,
  collection: string,
  data: Data
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

export const getSpan = (op: string, name: string, data: Data) => {
  return Sentry.getCurrentHub().getScope()?.getTransaction()?.startChild({
    op,
    description: name,
    data
  })
}
