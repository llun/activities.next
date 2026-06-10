import { cookies } from 'next/headers'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase, getKnex } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { hasSameOriginProof } from '@/lib/services/guards/sameOriginProof'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const ALLOWED_METHODS = [HttpMethod.enum.POST]

const SwitchActorRequest = z.object({
  actorId: z.string().min(1)
})

export const POST = traceApiRoute('switchActor', async (req: NextRequest) => {
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

  const body = await req.json().catch(() => null)
  const parsed = SwitchActorRequest.safeParse(body)

  if (!parsed.success) {
    return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
  }

  const { actorId } = parsed.data

  const account = await database.getAccountFromEmail({
    email: session.user.email
  })
  if (!account) {
    return apiErrorResponse(HTTP_STATUS.UNAUTHORIZED)
  }

  const actors = await database.getActorsForAccount({ accountId: account.id })
  const validActor = actors.find((actor) => actor.id === actorId)
  if (!validActor) {
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: { error: 'Actor not found or not owned by account' },
      responseStatusCode: HTTP_STATUS.NOT_FOUND
    })
  }

  // Check if actor is pending deletion or being deleted
  if (validActor.deletionStatus) {
    return apiResponse({
      req,
      allowedMethods: ALLOWED_METHODS,
      data: {
        error:
          'Cannot switch to an actor that is pending deletion or being deleted'
      },
      responseStatusCode: HTTP_STATUS.BAD_REQUEST
    })
  }

  // Update the better-auth session's actorId so OAuth consentReferenceId
  // picks up the correct actor when minting access tokens.
  const db = getKnex()
  if (session?.session?.token) {
    try {
      await db('sessions')
        .where('token', session.session.token)
        .update({ actorId })
    } catch (e) {
      logger.error({ message: 'Failed to update session actorId', error: e })
      return apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }
  }

  // Set a cookie to track the selected actor
  const cookieStore = await cookies()
  const isSecure = req.url.startsWith('https')
  cookieStore.set('activities.actor-id', actorId, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30 // 30 days
  })

  return apiResponse({
    req,
    allowedMethods: ALLOWED_METHODS,
    data: {
      id: validActor.id,
      username: validActor.username,
      domain: validActor.domain,
      name: validActor.name,
      iconUrl: validActor.iconUrl
    }
  })
})
