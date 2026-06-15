import { activityPubRequestHeaders } from '@/lib/activities/activityPubHeaders'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { Actor } from '@/lib/types/activitypub'
import { Actor as DomainActor } from '@/lib/types/domain/actor'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
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
      const { statusCode, body } = await request({
        url: actorId,
        headers: activityPubRequestHeaders({
          url: actorId,
          signingActor
        }),
        // Use default retry by set it to undefined, otherwise 0 retry
        numberOfRetry: withNetworkRetry ? undefined : 0
      })
      if (statusCode !== 200) {
        return null
      }
      const compactedActor = await compactActivityPub(JSON.parse(body))
      const actorResult = Actor.safeParse(compactedActor)
      if (!actorResult.success) {
        logger.error(`[getActorProfile] ${actorResult.error.message}`)
        return null
      }
      return actorResult.data
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      span.recordException(nodeError)
      logger.error(`[getActorProfile] ${nodeError.message}`)
      return null
    } finally {
      span.end()
    }
  })
