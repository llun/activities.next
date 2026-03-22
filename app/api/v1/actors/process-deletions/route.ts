import { NextRequest } from 'next/server'

import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'processActorDeletions',
  AuthenticatedGuard(async (req: NextRequest, { database }) => {
    // Get all actors scheduled for deletion before now
    const actorsToDelete = await database.getActorsScheduledForDeletion({
      beforeDate: new Date()
    })

    const queue = getQueue()
    const results: Array<{ actorId: string; status: string }> = []

    for (const actor of actorsToDelete) {
      try {
        // Publish delete job
        await queue.publish({
          id: `delete-actor-${actor.id}-${Date.now()}`,
          name: DELETE_ACTOR_JOB_NAME,
          data: { actorId: actor.id }
        })
        results.push({ actorId: actor.id, status: 'queued' })
      } catch (_error) {
        results.push({ actorId: actor.id, status: 'failed' })
      }
    }

    return apiResponse({
      req,
      allowedMethods: [HttpMethod.enum.POST],
      data: {
        processed: results.length,
        results
      }
    })
  })
)
