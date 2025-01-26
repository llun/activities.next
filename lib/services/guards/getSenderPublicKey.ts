import { HTTPError } from 'got'

import { getPublicProfile } from '@/lib/activities'
import { Storage } from '@/lib/database/types'
import { getTracer } from '@/lib/utils/trace'

export async function getSenderPublicKey(storage: Storage, actorId: string) {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    'guard.getSenderPublicKey',
    { attributes: { actorId } },
    async (span) => {
      const localActor = await storage.getActorFromId({ id: actorId })
      if (localActor) {
        span.end()
        return localActor.publicKey
      }

      try {
        const sender = await getPublicProfile({
          actorId,
          withCollectionCount: false,
          withPublicKey: true,
          withNetworkRetry: false
        })

        if (sender) return sender.publicKey || ''
        return ''
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        if (!(nodeError instanceof HTTPError)) {
          throw error
        }

        if (nodeError.response.statusCode === 410) {
          const url = new URL(actorId)
          const sender = await getPublicProfile({
            actorId: `${url.protocol}//${url.host}/actor#main-key`,
            withPublicKey: true,
            withNetworkRetry: false
          })

          if (sender) return sender.publicKey || ''
          return ''
        }

        return ''
      } finally {
        span.end()
      }
    }
  )
}
