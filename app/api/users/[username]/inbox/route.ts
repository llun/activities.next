import { z } from 'zod'

import { acceptFollowRequest } from '@/lib/actions/acceptFollowRequest'
import { createFollower } from '@/lib/actions/createFollower'
import { likeRequest } from '@/lib/actions/like'
import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { FollowRequest } from '@/lib/activities/followAction'
import { UndoFollow } from '@/lib/activities/undoFollow'
import { UndoLike } from '@/lib/activities/undoLike'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardParams
} from '@/lib/services/guards/OnlyLocalUserGuard'
import { Accept, Follow, Like, Reject, Undo } from '@/lib/types/activitypub'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_403,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]
const Activity = z.union([Accept, Reject, Follow, Like, Undo])

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'actorInbox',
  ActivityPubVerifySenderGuard<OnlyLocalUserGuardParams>(
    (req, context) =>
      OnlyLocalUserGuard(async (database, _, req) => {
        try {
          const parsed = Activity.safeParse(await req.json())
          if (!parsed.success) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_400,
              responseStatusCode: 400
            })
          }

          const activity = parsed.data
          if (!(await canFederateWithDomain(database, activity.actor))) {
            return apiResponse({
              req,
              allowedMethods: CORS_HEADERS,
              data: ERROR_403,
              responseStatusCode: 403
            })
          }

          switch (activity.type) {
            case 'Accept': {
              const follow = await acceptFollowRequest({ activity, database })
              if (!follow)
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: ERROR_404,
                  responseStatusCode: 404
                })
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }
            case 'Reject': {
              const follow = await rejectFollowRequest({ activity, database })
              if (!follow)
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: ERROR_404,
                  responseStatusCode: 404
                })
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
              if (!follow)
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: ERROR_404,
                  responseStatusCode: 404
                })
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
                  if (!result)
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_404,
                      responseStatusCode: 404
                    })
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
          return apiResponse({
            req,
            allowedMethods: CORS_HEADERS,
            data: ERROR_400,
            responseStatusCode: 400
          })
        }
      })(req, context),
    CORS_HEADERS
  )
)
