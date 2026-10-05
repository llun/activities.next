import { trace } from '@opentelemetry/api'
import { z } from 'zod'

import { publishActorDeletion } from '@/lib/services/actors/actorDeletion'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
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
    // Span attributes are set here, behind the guard, rather than through
    // `traceApiRoute`'s `addAttributes`: that hook runs BEFORE the handler, so
    // parsing the body there made unauthenticated callers pay for it.
    trace.getActiveSpan()?.setAttributes({ actorId, delayDays })
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

    // An immediate deletion runs now. A delayed one is queued with a delay (or,
    // under the in-process queue, left for the periodic sweep) so it is carried
    // out when it comes due rather than staying 'scheduled' forever.
    await publishActorDeletion({ actorId, scheduledAt })
    logger.info({
      message: scheduledAt
        ? 'Handed delayed delete actor job to the queue'
        : 'Published immediate delete actor job',
      actorId
    })

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
  })
)
