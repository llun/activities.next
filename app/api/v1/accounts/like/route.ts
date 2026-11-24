/**

 * @deprecated Use POST /api/v1/statuses/:id/favourite instead
 * This custom endpoint is maintained for backward compatibility.
 */
import { sendLike, sendUndoLike } from '@/lib/activities'
import {
  blueskyInteractionFailure,
  likeBlueskyPost,
  unlikeBlueskyPost
} from '@/lib/services/bluesky/interactions'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getReadableStatusForAction } from '@/lib/services/statuses/getReadableStatusForAction'
import { getOriginalStatus, isBlueskyStatus } from '@/lib/types/domain/status'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_404,
  ERROR_422,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

import { LikeStatusRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'likeToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const parsed = LikeStatusRequest.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const { statusId } = parsed.data
    const status = await getReadableStatusForAction({
      database,
      statusId,
      currentActor,
      withReplies: false
    })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    if (isBlueskyStatus(status)) {
      try {
        await likeBlueskyPost(
          database,
          currentActor,
          getOriginalStatus(status).id
        )
      } catch (error) {
        const failure = blueskyInteractionFailure(error)
        if (!failure) throw error
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: failure.error },
          responseStatusCode: failure.status
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_202
      })
    }

    // Each Like is its own retrying delivery: a repeat of an existing like
    // sends nothing.
    // The write decides, so a concurrent unlike cannot leave a new like
    // unsent.
    const created = await database.createLike({
      actorId: currentActor.id,
      statusId: status.id
    })
    if (created) await sendLike({ currentActor, status })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  })
)

export const DELETE = traceApiRoute(
  'unlikeToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const parsed = LikeStatusRequest.safeParse(body)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_422,
        responseStatusCode: 422
      })
    }

    const { statusId } = parsed.data
    // Like /unfavourite: a like is removable even from a status the actor can
    // no longer read.
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    if (isBlueskyStatus(status)) {
      try {
        await unlikeBlueskyPost(
          database,
          currentActor,
          getOriginalStatus(status).id
        )
      } catch (error) {
        const failure = blueskyInteractionFailure(error)
        if (!failure) throw error
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: { error: failure.error },
          responseStatusCode: failure.status
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: DEFAULT_202
      })
    }

    const removed = await database.deleteLike({
      actorId: currentActor.id,
      statusId: status.id
    })
    if (removed) await sendUndoLike({ currentActor, status })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  })
)
