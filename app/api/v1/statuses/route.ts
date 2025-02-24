import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const NoteSchema = z.object({
  status: z.string(),
  in_reply_to_id: z.string().optional(),
  spoiler_text: z.string().optional(),
  media_ids: z.array(z.string()).optional()
})

export const POST = OAuthGuard([Scope.enum.write], async (req, context) => {
  const { currentActor, database } = context
  try {
    const content = await req.json()
    const note = NoteSchema.parse(content)
    const status = await createNoteFromUserInput({
      currentActor,
      text: note.status,
      replyNoteId: note.in_reply_to_id,
      attachments: [],
      database
    })
    if (!status) return apiErrorResponse(422)
    return apiResponse(req, CORS_HEADERS, {
      id: status.id,
      created_at: getISOTimeUTC(status.createdAt),
      content: status.text
    })
  } catch {
    return apiErrorResponse(400)
  }
})
