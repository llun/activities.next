import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { deleteStatusFromUserInput } from '@/lib/actions/deleteStatus'
import {
  DEFAULT_202,
  apiErrorResponse,
  defaultStatusOption
} from '@/lib/response'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'

import { DeleteStatusRequest, PostRequest } from './types'

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
        return Response.json({
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
    return Response.json(DEFAULT_202, defaultStatusOption(202))
  } catch {
    return apiErrorResponse(400)
  }
})
