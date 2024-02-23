import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
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
  const { currentActor, storage } = context
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
          storage
        })
        if (!status) return apiErrorResponse(404)
        return apiResponse(req, CORS_HEADERS, {
          status: status.toJson(),
          note: status.toObject(),
          attachments: status.attachments
        })
      }
      default: {
        return apiErrorResponse(404)
      }
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    console.error(nodeError.message)
    console.error(nodeError.stack)
    return apiErrorResponse(400)
  }
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { currentActor, storage } = context
  const body = await req.json()
  try {
    const request = DeleteStatusRequest.parse(body)
    await deleteStatusFromUserInput({
      currentActor,
      storage,
      statusId: request.statusId
    })
    return apiResponse(req, CORS_HEADERS, DEFAULT_202)
  } catch {
    return apiErrorResponse(400)
  }
})
