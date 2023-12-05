import { z } from 'zod'

import { updateNoteFromUserInput } from '../../../../../lib/actions/updateNote'
import { ERROR_400, ERROR_403 } from '../../../../../lib/errors'
import { AuthenticatedGuard } from '../../../../../lib/guard'
import { getISOTimeUTC } from '../../../../../lib/time'

interface Params {
  id: string
}

const EditNoteSchema = z.object({
  status: z.string(),
  spoiler_text: z.string().optional()
})

type EditNoteSchema = z.infer<typeof EditNoteSchema>

export const PUT = AuthenticatedGuard<Params>(async (req, context, params) => {
  const id = params?.params.id
  if (!id) {
    return Response.json(ERROR_400, { status: 400 })
  }

  const { storage, currentActor } = context
  const statusId = `${currentActor.id}/statuses/${id}`
  const changes = EditNoteSchema.parse(await req.json())
  const updatedNote = await updateNoteFromUserInput({
    statusId,
    currentActor,
    text: changes.status,
    summary: changes.spoiler_text,
    storage
  })

  if (!updatedNote) {
    return Response.json(ERROR_403, { status: 403 })
  }
  return Response.json({
    id: updatedNote.id,
    created_at: getISOTimeUTC(updatedNote.createdAt),
    in_reply_to_id: updatedNote.reply,
    edited_at: getISOTimeUTC(updatedNote.updatedAt),
    content: updatedNote.content
  })
})
