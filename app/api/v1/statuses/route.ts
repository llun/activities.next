import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { apiErrorResponse } from '@/lib/utils/response'

const NoteSchema = z.object({
  status: z.string(),
  in_reply_to_id: z.string().optional(),
  spoiler_text: z.string().optional(),
  media_ids: z.array(z.string()).optional()
})

export const POST = AuthenticatedGuard(async (req, context) => {
  const { currentActor, storage } = context
  try {
    const content = await req.json()
    const note = NoteSchema.parse(content)
    const status = await createNoteFromUserInput({
      currentActor,
      text: note.status,
      replyNoteId: note.in_reply_to_id,
      attachments: [],
      storage
    })
    if (!status) return apiErrorResponse(422)
    return Response.json({
      id: status.id,
      created_at: getISOTimeUTC(status.createdAt),
      content: status.content
    })
  } catch {
    return apiErrorResponse(400)
  }
})
