import { Accept, Follow, Like, Reject, Undo } from '@llun/activities.schema'
import { z } from 'zod'

import { acceptFollowRequest } from '../../../../../lib/actions/acceptFollowRequest'
import { createFollower } from '../../../../../lib/actions/createFollower'
import { likeRequest } from '../../../../../lib/actions/like'
import { rejectFollowRequest } from '../../../../../lib/actions/rejectFollowRequest'
import { FollowRequest } from '../../../../../lib/activities/actions/follow'
import { UndoFollow } from '../../../../../lib/activities/actions/undoFollow'
import { UndoLike } from '../../../../../lib/activities/actions/undoLike'
import { DEFAULT_202, ERROR_400, ERROR_404 } from '../../../../../lib/errors'
import { FollowStatus } from '../../../../../lib/models/follow'
import { OnlyLocalUserGuard } from '../guard'

const Activity = z.union([Accept, Reject, Follow, Like, Undo])

export const POST = OnlyLocalUserGuard(async (storage, _, req) => {
  try {
    const activity = Activity.parse(await req.json())
    switch (activity.type) {
      case 'Accept': {
        const follow = await acceptFollowRequest({ activity, storage })
        if (!follow) {
          return Response.json(ERROR_404, { status: 404 })
        }
        return Response.json(DEFAULT_202, { status: 202 })
      }
      case 'Reject': {
        const follow = await rejectFollowRequest({ activity, storage })
        if (!follow) {
          return Response.json(ERROR_404, { status: 404 })
        }
        return Response.json(DEFAULT_202, { status: 202 })
      }
      case 'Follow': {
        const follow = await createFollower({
          followRequest: activity as FollowRequest,
          storage
        })
        if (!follow) {
          return Response.json(ERROR_404, { status: 404 })
        }
        return Response.json({ target: follow.object }, { status: 202 })
      }
      case 'Like': {
        await likeRequest({ activity, storage })
        return Response.json(DEFAULT_202, { status: 202 })
      }
      case 'Undo': {
        const undoRequest = activity as UndoFollow | UndoLike
        switch (undoRequest.object.type) {
          case 'Follow': {
            const follow = await storage.getAcceptedOrRequestedFollow({
              actorId: undoRequest.object.actor,
              targetActorId: undoRequest.object.object
            })
            if (!follow) {
              console.error('Fail to find follow', undoRequest)
              return Response.json(ERROR_404, { status: 404 })
            }
            await storage.updateFollowStatus({
              followId: follow.id,
              status: FollowStatus.Undo
            })
            return Response.json(
              { target: undoRequest.object.object },
              { status: 202 }
            )
          }
          case 'Like': {
            await storage.deleteLike({
              actorId: undoRequest.object.actor,
              statusId:
                typeof undoRequest.object.object === 'string'
                  ? undoRequest.object.object
                  : undoRequest.object.object.id
            })
            return Response.json(DEFAULT_202, { status: 202 })
          }
          default: {
            return Response.json(DEFAULT_202, { status: 202 })
          }
        }
      }
      default:
        return Response.json(DEFAULT_202, { status: 202 })
    }
  } catch (e) {
    const error = e as NodeJS.ErrnoException
    console.error(error.message)
    return Response.json(ERROR_400, { status: 400 })
  }
})
