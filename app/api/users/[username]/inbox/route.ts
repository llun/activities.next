import { z } from 'zod'

import { acceptFollowRequest } from '@/lib/actions/acceptFollowRequest'
import { applyRemoteBlock } from '@/lib/actions/applyRemoteBlock'
import { applyRemoteUnblock } from '@/lib/actions/applyRemoteUnblock'
import { createFollower } from '@/lib/actions/createFollower'
import { likeRequest } from '@/lib/actions/like'
import { rejectFollowRequest } from '@/lib/actions/rejectFollowRequest'
import { undoFollowRequest } from '@/lib/actions/undoFollowRequest'
import { FollowRequest } from '@/lib/activities/followAction'
import { compactActivityPub } from '@/lib/activities/jsonld'
import { UndoFollow } from '@/lib/activities/undoFollow'
import { canFederateWithDomain } from '@/lib/services/federation/domainPolicy'
import { isFederationSigningActor } from '@/lib/services/federation/instanceActor'
import { ActivityPubVerifySenderGuard } from '@/lib/services/guards/ActivityPubVerifyGuard'
import {
  OnlyLocalUserGuard,
  OnlyLocalUserGuardParams
} from '@/lib/services/guards/OnlyLocalUserGuard'
import {
  Accept,
  Block,
  Follow,
  Like,
  Reject,
  Undo
} from '@/lib/types/activitypub'
import { normalizeActorId } from '@/lib/utils/activitypub'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
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
const GracefullyAcceptedActivity = z
  .object({
    id: z.string(),
    type: z.enum(['Flag', 'Move', 'Add', 'Remove', 'QuoteRequest']),
    actor: z.string()
  })
  .passthrough()
const ReferenceUndo = z
  .object({
    id: z.string(),
    actor: z.string(),
    type: z.literal('Undo'),
    object: z.union([
      z.string(),
      z
        .object({
          type: z.string()
        })
        .passthrough()
    ])
  })
  .passthrough()
const Activity = z.union([
  Accept,
  Reject,
  Follow,
  Block,
  Like,
  Undo,
  ReferenceUndo,
  GracefullyAcceptedActivity
])

const actorIdsMatch = (firstActorId: string, secondActorId: string) => {
  const normalizedFirstActorId = normalizeActorId(firstActorId)
  const normalizedSecondActorId = normalizeActorId(secondActorId)

  return (
    Boolean(normalizedFirstActorId) &&
    normalizedFirstActorId === normalizedSecondActorId
  )
}

const logAcceptedWithoutSideEffects = ({
  activity,
  reason
}: {
  activity: { id?: string; type: string; actor?: string }
  reason: string
}) => {
  logger.info({
    message: 'Accepted ActivityPub inbox activity without local side effects',
    activityId: activity.id,
    activityType: activity.type,
    actorId: activity.actor,
    reason
  })
}

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'actorInbox',
  ActivityPubVerifySenderGuard<OnlyLocalUserGuardParams>(
    (req, context) =>
      OnlyLocalUserGuard(
        async (database, actor, req) => {
          try {
            if (isFederationSigningActor(actor)) {
              return apiResponse({
                req,
                allowedMethods: CORS_HEADERS,
                data: DEFAULT_202,
                responseStatusCode: 202
              })
            }

            const compactedActivity = await compactActivityPub(
              context.activityBody
            )
            const parsed = Activity.safeParse(compactedActivity)
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
              case 'Block': {
                const block = await applyRemoteBlock({
                  database,
                  activity,
                  targetActorId: actor.id
                })
                if (!block)
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
                const undoObject = activity.object
                if (typeof undoObject === 'string') {
                  const block = await applyRemoteUnblock({
                    database,
                    actorId: activity.actor,
                    object: undoObject,
                    targetActorId: actor.id
                  })
                  if (block) {
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: DEFAULT_202,
                      responseStatusCode: 202
                    })
                  }

                  logAcceptedWithoutSideEffects({
                    activity,
                    reason: 'reference-only Undo object'
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                const undoFollow = Follow.safeParse(undoObject)
                if (undoFollow.success) {
                  if (!actorIdsMatch(activity.actor, undoFollow.data.actor)) {
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_403,
                      responseStatusCode: 403
                    })
                  }

                  const result = await undoFollowRequest({
                    database,
                    request: {
                      ...activity,
                      object: undoFollow.data
                    } as UndoFollow
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
                    data: { target: undoFollow.data.object },
                    responseStatusCode: 202
                  })
                }

                const undoLike = Like.safeParse(undoObject)
                if (undoLike.success) {
                  const likedObject = undoLike.data.object
                  await database.deleteLike({
                    actorId: activity.actor,
                    statusId:
                      typeof likedObject === 'string'
                        ? likedObject
                        : likedObject.id
                  })
                  return apiResponse({
                    req,
                    allowedMethods: CORS_HEADERS,
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                const undoBlock = Block.safeParse(undoObject)
                if (undoBlock.success) {
                  if (!actorIdsMatch(activity.actor, undoBlock.data.actor)) {
                    return apiResponse({
                      req,
                      allowedMethods: CORS_HEADERS,
                      data: ERROR_403,
                      responseStatusCode: 403
                    })
                  }

                  const result = await applyRemoteUnblock({
                    database,
                    actorId: activity.actor,
                    object: undoBlock.data,
                    targetActorId: actor.id
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
                    data: DEFAULT_202,
                    responseStatusCode: 202
                  })
                }

                logAcceptedWithoutSideEffects({
                  activity,
                  reason: `unsupported Undo object type ${undoObject.type}`
                })
                return apiResponse({
                  req,
                  allowedMethods: CORS_HEADERS,
                  data: DEFAULT_202,
                  responseStatusCode: 202
                })
              }
              default:
                logAcceptedWithoutSideEffects({
                  activity,
                  reason: 'unsupported but accepted ActivityPub activity type'
                })
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
        },
        { allowFederationSigningActor: true }
      )(req, context),
    CORS_HEADERS
  )
)
