import { Accept, Follow, Like, Reject, Undo } from '@llun/activities.schema'
import { z } from 'zod'

import { acceptFollowRequest } from '@/lib/actions/acceptFollowRequest'
import { createFollower } from '@/lib/actions/createFollower'
import { likeRequest } from '@/lib/actions/like'
import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { FollowRequest } from '@/lib/activities/actions/follow'
import { UndoFollow } from '@/lib/activities/actions/undoFollow'
import { UndoLike } from '@/lib/activities/actions/undoLike'
import { OnlyLocalUserGuard } from '@/lib/services/guards/OnlyLocalUserGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const Activity = z.union([Accept, Reject, Follow, Like, Undo])

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = OnlyLocalUserGuard(async (storage, _, req) => {
  try {
    const activity = Activity.parse(await req.json())
    switch (activity.type) {
      case 'Accept': {
        const follow = await acceptFollowRequest({ activity, storage })
        if (!follow) return apiErrorResponse(404)
        return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
      }
      case 'Reject': {
        const follow = await rejectFollowRequest({ activity, storage })
        if (!follow) return apiErrorResponse(404)
        return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
      }
      case 'Follow': {
        const follow = await createFollower({
          followRequest: activity as FollowRequest,
          storage
        })
        if (!follow) return apiErrorResponse(404)
        return apiResponse(req, CORS_HEADERS, { target: follow.object }, 202)
      }
      case 'Like': {
        await likeRequest({ activity, storage })
        return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
      }
      case 'Undo': {
        const undoRequest = activity as UndoFollow | UndoLike
        switch (undoRequest.object.type) {
          case 'Follow': {
            const result = await undoFollowRequest({
              storage,
              request: undoRequest as UndoFollow
            })
            if (result) return apiErrorResponse(404)
            return apiResponse(
              req,
              CORS_HEADERS,
              { target: undoRequest.object.object },
              202
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
            return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
          }
          default: {
            return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
          }
        }
      }
      default:
        return apiResponse(req, CORS_HEADERS, DEFAULT_202, 202)
    }
  } catch {
    return apiErrorResponse(400)
  }
})
