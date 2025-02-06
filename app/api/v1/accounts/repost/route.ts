import { z } from 'zod'

import { userAnnounce } from '@/lib/actions/announce'
import { userUndoAnnounce } from '@/lib/actions/undoAnnounce'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { DEFAULT_202, apiResponse, defaultOptions } from '@/lib/utils/response'

const RepostRequest = z.object({ statusId: z.string() })

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.POST,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const POST = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userAnnounce({ currentActor, statusId, database })
  return apiResponse(req, CORS_HEADERS, DEFAULT_202)
})

export const DELETE = AuthenticatedGuard(async (req, context) => {
  const { database, currentActor } = context
  const body = await req.json()
  const { statusId } = RepostRequest.parse(body)
  await userUndoAnnounce({ currentActor, statusId, database })
  return apiResponse(req, CORS_HEADERS, DEFAULT_202)
})
