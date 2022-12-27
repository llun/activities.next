import { createNoteFromUserInput } from '../../../../lib/actions/createNote'
import { deleteStatus, sendNote } from '../../../../lib/activities'
import { CreateStatusParams, DeleteStatusParams } from '../../../../lib/client'
import { ERROR_404 } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'

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
        return res.status(500).json({ error: 'Fail to create note' })
      }

      const inboxes = await storage.getFollowersInbox({
        targetActorId: currentActor.id
      })
      await Promise.all(
        inboxes.map((inbox) => {
          return sendNote({
            currentActor,
            inbox,
            note: status.toObject()
          })
        })
      )
      return res.status(200).json({
        status: status?.toJson(),
        note: status.toObject(),
        attachments: status.data.attachments
      })
    }
    case 'DELETE': {
      const { statusId } = req.body as DeleteStatusParams
      console.log('Delete status id', statusId)
      await storage.deleteStatus({ statusId })
      const inboxes = await storage.getFollowersInbox({
        targetActorId: currentActor.id
      })
      await Promise.all(
        inboxes.map((inbox) => {
          return deleteStatus({
            currentActor,
            inbox,
            statusId
          })
        })
      )
      return res.status(200).json({})
    }
    default: {
      res.status(404).json(ERROR_404)
    }
  }
})

export default handler
