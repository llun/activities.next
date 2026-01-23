import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute('lookupAccount', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database) return apiErrorResponse(500)

  const url = new URL(req.url)
  const acct = url.searchParams.get('acct')

  if (!acct) return apiErrorResponse(400)

  // Parse acct format: username or username@domain
  const [username, domain] = acct.includes('@')
    ? acct.split('@')
    : [acct, getConfig().host]

  if (!username) return apiErrorResponse(400)

  const actor = await database.getActorFromUsername({ username, domain })

  if (!actor) return apiErrorResponse(404)

  const mastodonActor = await database.getMastodonActorFromId({ id: actor.id })
  if (!mastodonActor) return apiErrorResponse(404)

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: mastodonActor
  })
})
