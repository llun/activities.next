import z from 'zod'

import { updateNoteFromUserInput } from '../../../../lib/actions/updateNote'
import { errorResponse } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
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

        const changes = EditNoteSchema.parse(req.body)
        const updatedNote = await updateNoteFromUserInput({
          statusId,
          currentActor,
          text: changes.status,
          summary: changes.spoiler_text,
          storage
        })

        if (!updatedNote) {
          return errorResponse(res, 403)
        }

        res.status(200).json({
          id: updatedNote.id,
          created_at: getISOTimeUTC(updatedNote.createdAt),
          in_reply_to_id: updatedNote.reply,
          edited_at: getISOTimeUTC(updatedNote.updatedAt),
          content: updatedNote.content
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
