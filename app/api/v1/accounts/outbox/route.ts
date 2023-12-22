import { createNoteFromUserInput } from '../../../../../lib/actions/createNote'
import { deleteStatusFromUserInput } from '../../../../../lib/actions/deleteStatus'
import {
  DEFAULT_202,
  ERROR_400,
  ERROR_404,
  ERROR_500
} from '../../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../../lib/services/guards/AuthenticatedGuard'
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
        if (!status) {
          return Response.json(ERROR_500, { status: 500 })
        }
        return Response.json({
          status: status.toJson(),
          note: status.toObject(),
          attachments: status.attachments
        })
      }
      default: {
        return Response.json(ERROR_404, { status: 404 })
      }
    }
  } catch {
    return Response.json(ERROR_400, { status: 400 })
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
    return Response.json(DEFAULT_202, { status: 202 })
  } catch {
    return Response.json(ERROR_400, { status: 400 })
  }
})
