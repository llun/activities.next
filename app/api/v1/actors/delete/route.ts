import { z } from 'zod'

import { DELETE_ACTOR_JOB_NAME } from '@/lib/jobs/names'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getQueue } from '@/lib/services/queue'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'

const DeleteActorRequest = z.object({
  actorId: z.string().min(1),
  delayDays: z.number().min(0).max(30).optional() // 0 = immediate, 3 = 3 days delay
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, database } = context

  if (!currentActor.account) {
    return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
  }

  const body = await req.json()
  const parsed = DeleteActorRequest.safeParse(body)

  if (!parsed.success) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Invalid request body' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  const { actorId, delayDays = 0 } = parsed.data

  // Get all actors for this account
  const actors = await database.getActorsForAccount({
    accountId: currentActor.account.id
  })

  // Find the actor to delete
  const actorToDelete = actors.find((actor) => actor.id === actorId)
  if (!actorToDelete) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Actor not found or not owned by account' },
      responseStatusCode: HTTP_STATUS.NOT_FOUND
    })
  }

  // Check if this is the default actor
  if (currentActor.account.defaultActorId === actorId) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Cannot delete the default actor' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  // Check if actor is already being deleted
  const deletionStatus = await database.getActorDeletionStatus({ id: actorId })
  if (deletionStatus?.status) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Actor is already scheduled for deletion or being deleted' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  // Check if this is the only actor (cannot delete last actor)
  const activeActors = actors.filter(
    (a) => !a.deletionStatus || a.deletionStatus === null
  )
  if (activeActors.length <= 1) {
    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: { error: 'Cannot delete the last actor on the account' },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  // Calculate scheduled deletion time
  const scheduledAt = delayDays > 0
    ? new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)
    : null

  // Schedule the deletion
  await database.scheduleActorDeletion({ actorId, scheduledAt })

  // If immediate deletion (no delay), publish the job now
  if (!scheduledAt) {
    const queue = getQueue()
    await queue.publish({
      id: `delete-actor-${actorId}-${Date.now()}`,
      name: DELETE_ACTOR_JOB_NAME,
      data: { actorId }
    })
  }

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
