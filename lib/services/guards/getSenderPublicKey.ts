import { HTTPError } from 'got'

import { getActorPerson } from '@/lib/activities/getActorPerson'
import { Database } from '@/lib/database/types'
import { getFederationSigningActor } from '@/lib/services/federation/getFederationSigningActor'
import { getTracer } from '@/lib/utils/trace'

export async function getSenderPublicKey(database: Database, actorId: string) {
  const tracer = getTracer()
  return tracer.startActiveSpan(
    'guard.getSenderPublicKey',
    { attributes: { actorId } },
    async (span) => {
      const localActor = await database.getActorFromId({ id: actorId })
      if (localActor) {
        span.end()
        return localActor.publicKey
      }

      const signingActor = await getFederationSigningActor(database)
      try {
        const sender = await getActorPerson({ actorId, signingActor })
        return sender?.publicKey.publicKeyPem ?? ''
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException
        span.recordException(nodeError)
        if (!(nodeError instanceof HTTPError)) {
          throw error
        }
        if (nodeError.response.statusCode === 410) {
          const url = new URL(actorId)
          const sender = await getActorPerson({
            actorId: `${url.protocol}//${url.host}/actor#main-key`,
            signingActor
          })
          return sender?.publicKey.publicKeyPem ?? ''
        }

        return ''
      } finally {
        span.end()
      }
    }
  )
}
