import { SpanStatusCode } from '@opentelemetry/api'
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
import { getSpan } from '@/lib/utils/trace'

const DeleteActorRequest = z.object({
  actorId: z.string().min(1),
  delayDays: z.number().min(0).max(30).optional() // 0 = immediate, 3 = 3 days delay
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const span = getSpan('api', 'deleteActor')
  const { currentActor, database } = context

  logger.info({ message: 'Delete actor request started' })

  if (!currentActor.account) {
    logger.warn({ message: 'Unauthorized delete actor request - no account' })
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Unauthorized' })
    span.end()
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
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid JSON body' })
    span.end()
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
      errors: parsed.error.errors
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Invalid request body'
    })
    span.end()
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Invalid request body' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  const { actorId, delayDays = 0 } = parsed.data
  span.setAttribute('actorId', actorId)
  span.setAttribute('delayDays', delayDays)
  logger.info({
    message: 'Processing delete actor request',
    actorId,
    delayDays,
    accountId: currentActor.account.id
  })

  // Get all actors for this account
  let actors
  try {
    actors = await database.getActorsForAccount({
      accountId: currentActor.account.id
    })
    logger.debug({
      message: 'Retrieved actors for account',
      accountId: currentActor.account.id,
      actorCount: actors.length
    })
  } catch (err) {
    logger.error({
      message: 'Failed to get actors for account',
      accountId: currentActor.account.id,
      err: err instanceof Error ? err : new Error(String(err))
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Failed to get actors for account'
    })
    span.recordException(err instanceof Error ? err : new Error(String(err)))
    span.end()
    throw err
  }

  // Find the actor to delete
  const actorToDelete = actors.find((actor) => actor.id === actorId)
  if (!actorToDelete) {
    logger.warn({
      message: 'Actor not found or not owned by account',
      actorId,
      accountId: currentActor.account.id
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Actor not found'
    })
    span.end()
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
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Cannot delete default actor'
    })
    span.end()
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Cannot delete the default actor' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  // Check if actor is already being deleted
  let deletionStatus
  try {
    deletionStatus = await database.getActorDeletionStatus({ id: actorId })
    logger.debug({
      message: 'Retrieved actor deletion status',
      actorId,
      deletionStatus: deletionStatus?.status ?? null
    })
  } catch (err) {
    logger.error({
      message: 'Failed to get actor deletion status',
      actorId,
      err: err instanceof Error ? err : new Error(String(err))
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Failed to get actor deletion status'
    })
    span.recordException(err instanceof Error ? err : new Error(String(err)))
    span.end()
    throw err
  }

  if (deletionStatus?.status) {
    logger.warn({
      message: 'Actor already scheduled for deletion',
      actorId,
      currentStatus: deletionStatus.status
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Actor already scheduled for deletion'
    })
    span.end()
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
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Cannot delete last actor'
    })
    span.end()
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
  try {
    await database.scheduleActorDeletion({ actorId, scheduledAt })
    logger.info({
      message: 'Scheduled actor deletion',
      actorId,
      scheduledAt: scheduledAt?.toISOString() ?? 'immediate'
    })
  } catch (err) {
    logger.error({
      message: 'Failed to schedule actor deletion',
      actorId,
      err: err instanceof Error ? err : new Error(String(err))
    })
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'Failed to schedule actor deletion'
    })
    span.recordException(err instanceof Error ? err : new Error(String(err)))
    span.end()
    throw err
  }

  // If immediate deletion (no delay), publish the job now
  if (!scheduledAt) {
    try {
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
    } catch (err) {
      logger.error({
        message: 'Failed to publish delete actor job',
        actorId,
        err: err instanceof Error ? err : new Error(String(err))
      })
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: 'Failed to publish delete actor job'
      })
      span.recordException(err instanceof Error ? err : new Error(String(err)))
      span.end()
      throw err
    }
  }

  logger.info({
    message: 'Delete actor request completed successfully',
    actorId,
    scheduledAt: scheduledAt?.toISOString() ?? null,
    immediate: !scheduledAt
  })
  span.setStatus({ code: SpanStatusCode.OK })
  span.end()

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
