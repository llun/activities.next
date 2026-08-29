import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { isAccountConfirmationPending } from '@/lib/services/auth/canCreateSessionForAccount'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { getAccountFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS = [HttpMethod.enum.POST]

const CancelDeletionRequest = z.object({
  actorId: z.string().min(1)
})

export const POST = traceApiRoute(
  'cancelActorDeletion',
  async (req: NextRequest) => {
    const database = getDatabase()
    const session = await getServerAuthSession()

    if (!database || !session?.user?.email) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    // This route authenticates the cookie session manually instead of using
    // AuthenticatedGuard, so it must apply the same CSRF same-origin proof.
    if (!hasSameOriginProof(req)) {
      return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
    }

    const account = await getAccountFromSession(database, session)
    if (!account) {
      return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
    }

    if (isAccountConfirmationPending(account)) {
      return apiErrorResponse(HTTP_STATUS.FORBIDDEN)
    }

    const body = await req.json().catch(() => null)
    const parsed = CancelDeletionRequest.safeParse(body)

    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: ALLOWED_METHODS,
        data: { error: 'Invalid request body' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    const { actorId } = parsed.data

    // Get all actors for this account
    const actors = await database.getActorsForAccount({
      accountId: account.id
    })

    // Find the actor
    const actor = actors.find((a) => a.id === actorId)
    if (!actor) {
      return apiResponse({
        req,
        allowedMethods: ALLOWED_METHODS,
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
        allowedMethods: ALLOWED_METHODS,
        data: { error: 'Actor is not scheduled for deletion' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    if (deletionStatus.status === 'deleting') {
      return apiResponse({
        req,
        allowedMethods: ALLOWED_METHODS,
        data: { error: 'Cannot cancel deletion that is already in progress' },
        responseStatusCode: HTTP_STATUS.BAD_REQUEST
      })
    }

    // Cancel the deletion
    await database.cancelActorDeletion({ actorId })

    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: {
        actorId,
        status: 'cancelled'
      }
    })
  }
)
