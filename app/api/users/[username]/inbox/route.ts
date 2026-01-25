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
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const Activity = z.union([Accept, Reject, Follow, Like, Undo])

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'actorInbox',
  OnlyLocalUserGuard(async (database, _, req) => {
    try {
      const activity = Activity.parse(await req.json())
      switch (activity.type) {
        case 'Accept': {
          const follow = await acceptFollowRequest({
            activity,
            database
          })
          if (!follow) return apiErrorResponse(404)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
        }
        case 'Reject': {
          const follow = await rejectFollowRequest({
            activity,
            database
          })
          if (!follow) return apiErrorResponse(404)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
        }
        case 'Follow': {
          const follow = await createFollower({
            followRequest: activity as FollowRequest,
            database
          })
          if (!follow) return apiErrorResponse(404)
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: { target: follow.object },
            responseStatusCode: 202
          })
        }
        case 'Like': {
          await likeRequest({ activity, database })
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
        }
        case 'Undo': {
          const undoRequest = activity as UndoFollow | UndoLike
          switch (undoRequest.object.type) {
            case 'Follow': {
              const result = await undoFollowRequest({
                database,
                request: undoRequest as UndoFollow
              })
              if (result) return apiErrorResponse(404)
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: { target: undoRequest.object.object },
                responseStatusCode: 202
              })
            }
            case 'Like': {
              await database.deleteLike({
                actorId: undoRequest.object.actor,
                statusId:
                  typeof undoRequest.object.object === 'string'
                    ? undoRequest.object.object
                    : undoRequest.object.object.id
              })
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }
            default: {
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }
          }
        }
        default:
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: DEFAULT_202,
            responseStatusCode: 202
          })
      }
    } catch {
      return apiErrorResponse(400)
    }
  })
)
