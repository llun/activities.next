import { z } from 'zod'

import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CancelDeletionRequest = z.object({
  actorId: z.string().min(1)
})

export const POST = traceApiRoute(
  'cancelActorDeletion',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context

    if (!currentActor.account) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    const body = await req.json()
    const parsed = CancelDeletionRequest.safeParse(body)

    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Invalid request body' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const { actorId } = parsed.data

    // Get all actors for this account
    const actors = await database.getActorsForAccount({
      accountId: currentActor.account.id
    })

    // Find the actor
    const actor = actors.find((a) => a.id === actorId)
    if (!actor) {
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Actor not found or not owned by account' },
        responseStatusCode: HTTP_STATUS.NOT_FOUND
      })
    }

    // Check if actor is scheduled for deletion (can only cancel if scheduled, not if already deleting)
    const deletionStatus = await database.getActorDeletionStatus({
      id: actorId
    })
    if (!deletionStatus?.status) {
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Actor is not scheduled for deletion' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    if (deletionStatus.status === 'deleting') {
      return apiResponse({
        req,
        allowedMethods: ['POST'],
        data: { error: 'Cannot cancel deletion that is already in progress' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    // Cancel the deletion
    await database.cancelActorDeletion({ actorId })

    return apiResponse({
      req,
      allowedMethods: ['POST'],
      data: {
        actorId,
        status: 'cancelled'
      }
    })
  })
)
