import { z } from 'zod'

import { createNoteFromUserInput } from '@/lib/actions/createNote'
import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.POST]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const VisibilitySchema = z.enum(['public', 'unlisted', 'private', 'direct'])

const NoteSchema = z.object({
  status: z.string(),
  in_reply_to_id: z.string().optional(),
  spoiler_text: z.string().optional(),
  media_ids: z.array(z.string()).optional(),
  visibility: VisibilitySchema.optional()
})

export const POST = traceApiRoute(
  'createStatus',
  OAuthGuard([Scope.enum.write], async (req, context) => {
    const { currentActor, database } = context
    try {
      const content = await req.json()
      const note = NoteSchema.parse(content)
      const status = await createNoteFromUserInput({
        currentActor,
        text: note.status,
        replyNoteId: note.in_reply_to_id,
        visibility: note.visibility,
        attachments: [],
        database
      })
      if (!status) return apiErrorResponse(422)

      const mastodonStatus = await getMastodonStatus(
        database,
        status,
        currentActor.id
      )
      if (!mastodonStatus) return apiErrorResponse(500)

      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: mastodonStatus
      })
    } catch {
      return apiErrorResponse(400)
    }
  })
)
