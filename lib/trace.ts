import * as Sentry from '@sentry/node'

// TODO: Convert this to decorator
export const getDatabaseSpan = (
  databaseMethod: string,
  collection: string,
  data: { [key: string]: string | undefined }
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
