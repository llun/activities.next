import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { toMastodonObject } from '@/lib/models/status'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  DEFAULT_202,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

import { DeleteStatusRequest, PostRequest } from './types'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, database } = context
  const body = await req.json()
  try {
    const request = PostRequest.parse(body)
    switch (request.type) {
      case 'note': {
        const { message, replyStatus, attachments } = request
        const status = await createNoteFromUserInput({
          currentActor,
          text: message,
          replyNoteId: replyStatus?.id,
          attachments,
          database
        })
        if (!status) return apiErrorResponse(404)
        return apiResponse(req, CORS_HEADERS, {
          status,
          note: toMastodonObject(status),
          attachments: status.attachments
        })
      }
      default: {
        return apiErrorResponse(404)
      }
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    logger.error(nodeError)
    return apiErrorResponse(400)
  }
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { currentActor, database } = context
  const body = await req.json()
  try {
    const request = DeleteStatusRequest.parse(body)
    await deleteStatusFromUserInput({
      currentActor,
      database,
      statusId: request.statusId
    })
    return apiResponse(req, CORS_HEADERS, DEFAULT_202)
  } catch {
    return apiErrorResponse(400)
  }
})
