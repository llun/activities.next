import { z } from 'zod'

import { updateNoteFromUserInput } from '@/lib/actions/updateNote'
import { Scope } from '@/lib/database/types/oauth'
import { StatusType } from '@/lib/models/status'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getMastodonStatus } from '@/lib/services/mastodon/getMastodonStatus'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { getISOTimeUTC } from '@/lib/utils/getISOTimeUTC'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { idToUrl } from '@/lib/utils/urlToId'

interface Params {
  id: string
}

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = OAuthGuard<Params>(
  [Scope.enum.read],
  async (req, context, params) => {
    const encodedStatusId = (await params?.params).id
    if (!encodedStatusId) return apiErrorResponse(404)

    const { database } = context
    const statusId = idToUrl(encodedStatusId)

    const status = await database.getStatus({ statusId })
    if (!status) return apiErrorResponse(404)

    const mastodonStatus = await getMastodonStatus(database, status)
    if (!mastodonStatus) return apiErrorResponse(404)

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: mastodonStatus
    })
  }
)

const EditNoteSchema = z.object({
  status: z.string(),
  spoiler_text: z.string().optional()
})

export const PUT = OAuthGuard<Params>(
  [Scope.enum.write],
  async (req, context, params) => {
    const encodedStatusId = (await params?.params).id
    if (!encodedStatusId) return apiErrorResponse(404)

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
  }
)
