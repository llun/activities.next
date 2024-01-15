import { follow, getPublicProfile, unfollow } from '@/lib/activities'
import { DEFAULT_202, ERROR_404 } from '@/lib/errors'
import { FollowStatus } from '@/lib/models/follow'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

import { FollowRequest } from './types'

export const GET = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const params = new URL(req.url).searchParams
  const targetActorId = params.get('targetActorId')
  if (!targetActorId) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const follow = await storage.getAcceptedOrRequestedFollow({
    actorId: currentActor.id,
    targetActorId: targetActorId as string
  })
  return Response.json({ follow })
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { target } = FollowRequest.parse(body)
  const profile = await getPublicProfile({ actorId: target })
  if (!profile) {
    return Response.json(ERROR_404, { status: 404 })
  }

  const followItem = await storage.createFollow({
    actorId: currentActor.id,
    targetActorId: target,
    status: FollowStatus.enum.Requested,
    inbox: `${currentActor.id}/inbox`,
    sharedInbox: `https://${currentActor.domain}/inbox`
  })
  await follow(followItem.id, currentActor, target)
  return Response.json(DEFAULT_202, { status: 202 })
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { storage, currentActor } = context
  const body = await req.json()
  const { target } = FollowRequest.parse(body)
  const profile = await getPublicProfile({ actorId: target })
  if (!profile) {
    return Response.json(ERROR_404, { status: 404 })
  }
  const follow = await storage.getAcceptedOrRequestedFollow({
    actorId: currentActor.id,
    targetActorId: target
  })
  if (!follow) {
    return Response.json(ERROR_404, { status: 404 })
  }
  await Promise.all([
    unfollow(currentActor, follow),
    storage.updateFollowStatus({
      followId: follow.id,
      status: FollowStatus.enum.Undo
    })
  ])
  return Response.json(DEFAULT_202, { status: 202 })
})
