import { NextRequest } from 'next/server'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  ERROR_400,
  ERROR_404,
  ERROR_500,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const parseAccountHandle = (value: string, localDomain: string) => {
  const normalized = value.trim().replace(/^@/, '')
  const segments = normalized.split('@')
  if (segments.length > 2) return null

  const [username, domain] =
    segments.length === 2 ? segments : [segments[0], localDomain]
  if (!username || !domain) return null

  return { username, domain }
}

export const GET = traceApiRoute('lookupAccount', async (req: NextRequest) => {
  const database = getDatabase()
  if (!database)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_500,
      responseStatusCode: 500
    })

  const url = new URL(req.url)
  const acct = url.searchParams.get('acct')
  const resolve = url.searchParams.get('resolve') === 'true'

  if (!acct)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_400,
      responseStatusCode: 400
    })

  const config = getConfig()
  const handle = parseAccountHandle(acct, config.host)

  if (!handle)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_400,
      responseStatusCode: 400
    })

  const { username, domain } = handle
  let actor = await database.getActorFromUsername({ username, domain })
  if (!actor && resolve && domain !== config.host) {
    const session = await getServerAuthSession()
    const canResolveRemote = Boolean(session?.user?.email)
    if (!canResolveRemote) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const actorId = await getWebfingerSelf({ account: `${username}@${domain}` })
    actor = actorId
      ? ((await recordActorIfNeeded({ actorId, database })) ?? null)
      : null
  }

  if (!actor)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })

  const mastodonActor = await database.getMastodonActorFromId({ id: actor.id })
  if (!mastodonActor)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_404,
      responseStatusCode: 404
    })

  return apiResponse({ req, allowedMethods: CORS_HEADERS, data: mastodonActor })
})
