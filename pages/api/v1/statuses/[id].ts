import z from 'zod'

import { errorResponse } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { StatusType } from '../../../../lib/models/status'
import { getFirstValueFromParsedQuery } from '../../../../lib/query'
import { getISOTimeUTC } from '../../../../lib/time'
import { ApiTrace } from '../../../../lib/trace'

const EditNoteSchema = z.object({
  status: z.string(),
  spoiler_text: z.string().optional()
})

export type EditNoteSchema = z.infer<typeof EditNoteSchema>

const handler = ApiTrace(
  'v1/statuses/[id]',
  ApiGuard(async (req, res, context) => {
    const { id } = req.query
    const { storage, currentActor } = context
    switch (req.method) {
      case 'PUT': {
        const statusId = getFirstValueFromParsedQuery(id)
        if (!statusId) {
          return errorResponse(res, 400)
        }

        const status = await storage.getStatus({
          statusId
        })
        if (
          currentActor.id !== status?.actorId ||
          status.type !== StatusType.Note
        ) {
          return errorResponse(res, 403)
        }

        const editNote = EditNoteSchema.parse(req.body)
        const updatedNote = await storage.updateNote({
          statusId,
          summary: editNote.spoiler_text,
          text: editNote.status
        })
        if (!updatedNote) {
          return errorResponse(res, 403)
        }

        res.status(200).json({
          id: status.id,
          created_at: getISOTimeUTC(status.createdAt),
          in_reply_to_id: status.reply,
          edited_at: getISOTimeUTC(updatedNote.updatedAt),
          content: status.content
        })
        return
      }
      default: {
        return errorResponse(res, 404)
      }
    }
  })
)
export default handler
