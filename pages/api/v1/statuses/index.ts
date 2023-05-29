import z from 'zod'

import { createNoteFromUserInput } from '../../../../lib/actions/createNote'
import { errorResponse } from '../../../../lib/errors'
import { ApiGuard } from '../../../../lib/guard'
import { getISOTimeUTC } from '../../../../lib/time'
import { ApiTrace } from '../../../../lib/trace'

export const NoteSchema = z.object({
  status: z.string(),
  in_reply_to_id: z.string().optional(),
  spoiler_text: z.string().optional(),
  media_ids: z.array(z.string()).optional()
})

export type NoteSchema = z.infer<typeof NoteSchema>

const handler = ApiTrace(
  'v1/statuses/index',
  ApiGuard(async (req, res, context) => {
    const { currentActor, storage } = context
    switch (req.method) {
      case 'POST': {
        const content = NoteSchema.parse(req.body)
        const status = await createNoteFromUserInput({
          currentActor,
          text: content.status,
          replyNoteId: content.in_reply_to_id,
          attachments: [],
          storage
        })
        if (!status) {
          return errorResponse(res, 422)
        }
        res.status(200).json({
          id: status.id,
          created_at: getISOTimeUTC(status.createdAt),
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
