/**
 * @deprecated Use POST /api/v1/statuses/:id/reblog and /unreblog instead
 * This custom endpoint is maintained for backward compatibility.
 */
import { z } from 'zod'

import { userAnnounce } from '@/lib/actions/announce'
import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const RepostRequest = z.object({ statusId: z.string() })

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = traceApiRoute(
  'repostToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
    const { statusId } = RepostRequest.parse(body)
    const announceStatus = await userAnnounce({
      currentActor,
      statusId,
      database
    })
    if (!announceStatus) {
      return apiErrorResponse(422)
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { statusId: announceStatus.id }
    })
  })
)

export const DELETE = traceApiRoute(
  'unrepostToAccount',
  AuthenticatedGuard(async (req, context) => {
    const { database, currentActor } = context
    const body = await req.json()
    const { statusId } = RepostRequest.parse(body)
    const undoStatus = await userUndoAnnounce({
      currentActor,
      statusId,
      database
    })
    if (!undoStatus) {
      return apiErrorResponse(422)
    }
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: { statusId: undoStatus.id }
    })
  })
)
