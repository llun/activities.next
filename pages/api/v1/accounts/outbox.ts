import { createNoteFromUserInput } from '../../../../lib/actions/createNote'
import { deleteStatusFromUserInput } from '../../../../lib/actions/deleteStatus'
import { CreateStatusParams, DeleteStatusParams } from '../../../../lib/client'
import { ApiGuard } from '../../../../lib/guard'
import { StatusNote } from '../../../../lib/models/status'
import { DEFAULT_202, ERROR_404, ERROR_500 } from '../../../../lib/responses'

const handler = ApiGuard(async (req, res, context) => {
  const { currentActor, storage } = context
  switch (req.method) {
    case 'POST': {
      const body = req.body
      const { message, replyStatus, attachments } = body as CreateStatusParams
      const status = await createNoteFromUserInput({
        currentActor,
        text: message,
        replyNoteId: replyStatus?.id,
        attachments,
        storage
      })
      if (!status) {
        return res.status(500).json(ERROR_500)
      }

      return res.status(200).json({
        status: status?.toJson(),
        note: status.toObject(),
        attachments: (status.data as StatusNote).attachments
      })
    }
    case 'DELETE': {
      const { statusId } = req.body as DeleteStatusParams
      await deleteStatusFromUserInput({ currentActor, statusId, storage })
      return res.status(202).json(DEFAULT_202)
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
