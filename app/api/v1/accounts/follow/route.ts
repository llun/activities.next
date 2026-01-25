/**
 * @deprecated Use POST /api/v1/accounts/:id/follow and /unfollow instead
 * This custom endpoint is maintained for backward compatibility.
 */
import { follow, unfollow } from '@/lib/activities'
import { getActorPerson } from '@/lib/activities/requests/getActorPerson'
import { FollowStatus } from '@/lib/models/follow'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { FollowRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getFollowFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const params = new URL(req.url).searchParams
    const targetActorId = params.get('targetActorId')
    if (!targetActorId) return apiErrorResponse(404)

    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId: targetActorId as string
    })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: { follow } })
  })
)

export const POST = traceApiRoute(
  'followAccountFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
    const { target } = FollowRequest.parse(body)
    const person = await getActorPerson({ actorId: target })
    if (!person) return apiErrorResponse(404)
    const followItem = await database.createFollow({
      actorId: currentActor.id,
      targetActorId: target,
      status: FollowStatus.enum.Requested,
      inbox: `${currentActor.id}/inbox`,
      sharedInbox: `https://${currentActor.domain}/inbox`
    })
    await follow(followItem.id, currentActor, target)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  })
)

export const DELETE = traceApiRoute(
  'unfollowAccountFromUrl',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
    const { target } = FollowRequest.parse(body)
    const follow = await database.getAcceptedOrRequestedFollow({
      actorId: currentActor.id,
      targetActorId: target
    })
    if (!follow) return apiErrorResponse(404)
    await Promise.all([
      unfollow(currentActor, follow),
      database.updateFollowStatus({
        followId: follow.id,
        status: FollowStatus.enum.Undo
      })
    ])
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: DEFAULT_202,
      responseStatusCode: HTTP_STATUS.ACCEPTED
    })
  })
)
