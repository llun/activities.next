import { follow, getPublicProfile, unfollow } from '@/lib/activities'
import { FollowStatus } from '@/lib/models/follow'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

import { FollowRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const params = new URL(req.url).searchParams
  const targetActorId = params.get('targetActorId')
  if (!targetActorId) return apiErrorResponse(404)

  const follow = await database.getAcceptedOrRequestedFollow({
    actorId: currentActor.id,
    targetActorId: targetActorId as string
  })
  return apiResponse(req, CORS_HEADERS, { follow })
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const body = await req.json()
  const { target } = FollowRequest.parse(body)
  const profile = await getPublicProfile({ actorId: target })
  if (!profile) return apiErrorResponse(404)

  const followItem = await database.createFollow({
    actorId: currentActor.id,
    targetActorId: target,
    status: FollowStatus.enum.Requested,
    inbox: `${currentActor.id}/inbox`,
    sharedInbox: `https://${currentActor.domain}/inbox`
  })
  await follow(followItem.id, currentActor, target)
  return apiResponse(req, CORS_HEADERS, DEFAULT_202)
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const body = await req.json()
  const { target } = FollowRequest.parse(body)
  const profile = await getPublicProfile({ actorId: target })
  if (!profile) return apiErrorResponse(404)
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
  return apiResponse(req, CORS_HEADERS, DEFAULT_202)
})
