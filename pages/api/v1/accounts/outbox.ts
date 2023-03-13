import * as Sentry from '@sentry/nextjs'

import { createNoteFromUserInput } from '../../../../lib/actions/createNote'
import { deleteStatusFromUserInput } from '../../../../lib/actions/deleteStatus'
import {
  CreateNoteParams,
  CreateQuestionParams,
  DeleteStatusParams
} from '../../../../lib/client'
import { ApiGuard } from '../../../../lib/guard'
import { StatusNote } from '../../../../lib/models/status'
import { DEFAULT_202, ERROR_404, ERROR_500 } from '../../../../lib/responses'
import { getSpan } from '../../../../lib/trace'

type CreateNoteRequest = { type: 'note' } & CreateNoteParams
type CreateQuestionRequest = { type: 'question' } & CreateQuestionParams

type PostRequest = CreateNoteRequest | CreateQuestionRequest

const handler = ApiGuard(async (req, res, context) => {
  const span = getSpan('api', 'outbox', { method: req.method })
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      const body = req.body as PostRequest
      try {
        switch (body.type) {
          case 'note': {
            const { message, replyStatus, attachments } = body
            const status = await createNoteFromUserInput({
              currentActor,
              text: message,
              replyNoteId: replyStatus?.id,
              attachments,
              storage
            })
            if (!status) {
              span?.finish()
              return res.status(500).json(ERROR_500)
            }

            span?.finish()
            return res.status(200).json({
              status: status?.toJson(),
              note: status.toObject(),
              attachments: (status.data as StatusNote).attachments
            })
          }
          default: {
            return res.status(404).json(ERROR_404)
          }
        }
      } catch (e: any) {
        Sentry.captureException(e)
        console.error(e.message)
        console.error(e.stack)
        span?.finish()
        return res.status(500).json(ERROR_500)
      }
    }
    case 'DELETE': {
      const { statusId } = req.body as DeleteStatusParams
      await deleteStatusFromUserInput({ currentActor, statusId, storage })
      span?.finish()
      return res.status(202).json(DEFAULT_202)
    }
    default: {
      span?.finish()
      return res.status(404).json(ERROR_404)
    }
  }
})

export default handler
