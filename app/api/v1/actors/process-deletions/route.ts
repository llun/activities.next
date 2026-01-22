import { NextRequest, NextResponse } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { getQueue } from '@/lib/services/queue'
import { HTTP_STATUS } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

export const POST = traceApiRoute(
  'processActorDeletions',
  async (req: NextRequest) => {
    const database = getDatabase()
    if (!database) {
      return NextResponse.json(
        { error: 'Database not available' },
        { status: HTTP_STATUS.INTERNAL_SERVER_ERROR }
      )
    }

    // Verify authorization using internal API key if configured
    const config = getConfig()
    const authHeader = req.headers.get('authorization')

    // Only allow if internal API is configured and key matches, or if no internal API is configured
    if (config.internalApi?.sharedKey) {
      if (authHeader !== `Bearer ${config.internalApi.sharedKey}`) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: HTTP_STATUS.UNAUTHORIZED }
        )
      }
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
