import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { signedGetHeaders } from '@/lib/utils/signature'
import { getTracer } from '@/lib/utils/trace'

export type GetActorPersonFunction = (params: {
  actorId: string
  withNetworkRetry?: boolean
  signingActor?: DomainActor
}) => Promise<Actor | null>

export const getActorPerson: GetActorPersonFunction = ({
  actorId,
  withNetworkRetry = true,
  signingActor
}) =>
  getTracer().startActiveSpan('activities.getActorProfile', async (span) => {
    try {
      const headers: Record<string, string> = { Accept: DEFAULT_ACCEPT }

      // Add signed headers if a signing actor is provided
      if (signingActor) {
        const signedHeaders = signedGetHeaders(signingActor, actorId)
        Object.assign(headers, signedHeaders)
      }

      const { statusCode, body } = await request({
        url: actorId,
        headers,
        // Use default retry by set it to undefined, otherwise 0 retry
        numberOfRetry: withNetworkRetry ? undefined : 0
      })
      if (statusCode !== 200) {
        return null
      }
      return Actor.parse(JSON.parse(body))
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      span.recordException(nodeError)
      logger.error(`[getActorProfile] ${nodeError.message}`)
      return null
    } finally {
      span.end()
    }
  })
