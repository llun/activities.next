import { NextRequest, NextResponse } from 'next/server'

import { getDatabase } from '@/lib/database'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { HTTP_STATUS } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'processActorDeletions',
  async (_req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      )
    }

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

    return NextResponse.json({
      processed: results.length,
      results
    })
  }
)
