import { z } from 'zod'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { StatusType } from '@/lib/models/status'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import { apiErrorResponse } from '@/lib/utils/response'
import { idToUrl } from '@/lib/utils/urlToId'

interface Params {
  id: string
}

const EditNoteSchema = z.object({
  status: z.string(),
  spoiler_text: z.string().optional()
})

export const PUT = AuthenticatedGuard<Params>(async (req, context, params) => {
  const encodedStatusId = (await params?.params).id
  if (!encodedStatusId) return apiErrorResponse(400)

  const { database, currentActor } = context
  const statusId = idToUrl(encodedStatusId)
  const changes = EditNoteSchema.parse(await req.json())
  const updatedNote = await updateNoteFromUserInput({
    statusId,
    currentActor,
    text: changes.status,
    summary: changes.spoiler_text,
    database
  })

  if (!updatedNote) return apiErrorResponse(403)
  if (updatedNote.type === StatusType.enum.Announce) {
    return apiErrorResponse(500)
  }

  return Response.json({
    id: updatedNote.id,
    created_at: getISOTimeUTC(updatedNote.createdAt),
    in_reply_to_id: updatedNote.reply,
    edited_at: getISOTimeUTC(updatedNote.updatedAt),
    content: updatedNote.text
  })
})
