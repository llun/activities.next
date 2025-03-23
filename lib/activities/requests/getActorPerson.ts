import { Actor } from '@llun/activities.schema'

import { DEFAULT_ACCEPT } from '@/lib/activities/constants'
import { logger } from '@/lib/utils/logger'
import { request } from '@/lib/utils/request'
import { getTracer } from '@/lib/utils/trace'

export type GetActorPersonFunction = (params: {
  actorId: string
  withNetworkRetry?: boolean
}) => Promise<Actor | null>

export const getActorPerson: GetActorPersonFunction = ({
  actorId,
  withNetworkRetry = true
}) =>
  getTracer().startActiveSpan('activities.getActorProfile', async (span) => {
    try {
      const { statusCode, body } = await request({
        url: actorId,
        headers: { Accept: DEFAULT_ACCEPT },
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
