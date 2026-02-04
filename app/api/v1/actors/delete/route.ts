import { z } from 'zod'

import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const DeleteActorRequest = z.object({
  actorId: z.string().min(1),
  delayDays: z.number().min(0).max(30).optional() // 0 = immediate, 3 = 3 days delay
})

export const POST = traceApiRoute(
  'deleteActor',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    logger.info({ message: 'Delete actor request started' })

    if (!currentActor.account) {
      logger.warn({ message: 'Unauthorized delete actor request - no account' })
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    let body: unknown
    try {
      body = await req.json()
    } catch (err) {
      logger.error({
        message: 'Failed to parse request body',
        err: err instanceof Error ? err : new Error(String(err))
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Invalid JSON body' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const parsed = DeleteActorRequest.safeParse(body)

    if (!parsed.success) {
      logger.warn({
        message: 'Invalid delete actor request body',
        errors: parsed.error.issues
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Invalid request body' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const { actorId, delayDays = 0 } = parsed.data
    logger.info({
      message: 'Processing delete actor request',
      actorId,
      delayDays,
      accountId: currentActor.account.id
    })

    // Get all actors for this account
    const actors = await database.getActorsForAccount({
      accountId: currentActor.account.id
    })
    logger.debug({
      message: 'Retrieved actors for account',
      accountId: currentActor.account.id,
      actorCount: actors.length
    })

    // Find the actor to delete
    const actorToDelete = actors.find((actor) => actor.id === actorId)
    if (!actorToDelete) {
      logger.warn({
        message: 'Actor not found or not owned by account',
        actorId,
        accountId: currentActor.account.id
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Actor not found or not owned by account' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    // Check if this is the default actor
    if (currentActor.account.defaultActorId === actorId) {
      logger.warn({
        message: 'Cannot delete default actor',
        actorId,
        defaultActorId: currentActor.account.defaultActorId
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Cannot delete the default actor' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    // Check if actor is already being deleted
    const deletionStatus = await database.getActorDeletionStatus({
      id: actorId
    })
    logger.debug({
      message: 'Retrieved actor deletion status',
      actorId,
      deletionStatus: deletionStatus?.status ?? null
    })

    if (deletionStatus?.status) {
      logger.warn({
        message: 'Actor already scheduled for deletion',
        actorId,
        currentStatus: deletionStatus.status
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: {
          error: 'Actor is already scheduled for deletion or being deleted'
        },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    // Check if this is the only actor (cannot delete last actor)
    const activeActors = actors.filter(
      (a) => !a.deletionStatus || a.deletionStatus === null
    )
    if (activeActors.length <= 1) {
      logger.warn({
        message: 'Cannot delete last actor on account',
        actorId,
        activeActorCount: activeActors.length
      })
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Cannot delete the last actor on the account' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    // Calculate scheduled deletion time
    const scheduledAt =
      delayDays > 0
        ? new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)
        : null

    // Schedule the deletion
    await database.scheduleActorDeletion({ actorId, scheduledAt })
    logger.info({
      message: 'Scheduled actor deletion',
      actorId,
      scheduledAt: scheduledAt?.toISOString() ?? 'immediate'
    })

    // If immediate deletion (no delay), publish the job now
    if (!scheduledAt) {
      const queue = getQueue()
      const jobId = `delete-actor-${actorId}-${Date.now()}`
      await queue.publish({
        id: jobId,
        name: DELETE_ACTOR_JOB_NAME,
        data: { actorId }
      })
      logger.info({
        message: 'Published immediate delete actor job',
        actorId,
        jobId
      })
    }

    logger.info({
      message: 'Delete actor request completed successfully',
      actorId,
      scheduledAt: scheduledAt?.toISOString() ?? null,
      immediate: !scheduledAt
    })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: {
        actorId,
        status: 'scheduled',
        scheduledAt: scheduledAt ? scheduledAt.toISOString() : null,
        immediate: !scheduledAt
      }
    })
  }),
  {
    addAttributes: async (req) => {
      const attributes: Record<string, string | number | boolean> = {}
      try {
        const body = await req.clone().json()
        const parsed = DeleteActorRequest.safeParse(body)
        if (parsed.success) {
          attributes.actorId = parsed.data.actorId
          attributes.delayDays = parsed.data.delayDays ?? 0
        }
      } catch {
        // Ignore parsing errors for attributes
      }
      return attributes
    }
  }
)
