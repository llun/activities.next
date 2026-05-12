/**

 * @deprecated Use POST /api/v1/statuses/:id/favourite instead
 * This custom endpoint is maintained for backward compatibility.
 */
import { sendLike, sendUndoLike } from '@/lib/activities'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  DEFAULT_202,
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
    const body = await req.json()
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
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    await database.createLike({ actorId: currentActor.id, statusId })
    await sendLike({ currentActor, status })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  })
)

export const DELETE = traceApiRoute(
  'unlikeToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
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
    const status = await database.getStatus({ statusId, withReplies: false })
    if (!status)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })

    await database.deleteLike({ actorId: currentActor.id, statusId })
    await sendUndoLike({ currentActor, status })
    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: DEFAULT_202 })
  })
)
