import { NextRequest } from 'next/server'

import { recordActorIfNeeded } from '@/lib/actions/utils'
import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  OptionalOAuthGuard,
  corsErrorResponse
} from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
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

const isBearerAuthorizationHeader = (authorizationHeader: string | null) =>
  authorizationHeader?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'bearer'

const authorizeBearerRemoteLookup = async (req: NextRequest) => {
  let authorized = false
  const response = await OptionalOAuthGuard(
    [Scope.enum.read, Scope.enum['read:accounts']],
    async () => {
      authorized = true
      return new Response(null, { status: 204 })
    },
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  )(req, { params: Promise.resolve({}) })

  return { authorized, response }
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
    const hasBearerAuthorization = isBearerAuthorizationHeader(
      req.headers.get('Authorization')
    )
    const session = hasBearerAuthorization ? null : await getServerAuthSession()
    let canResolveRemote = Boolean(session?.user?.email)
    if (!canResolveRemote && hasBearerAuthorization) {
      const bearerAuth = await authorizeBearerRemoteLookup(req)
      if (!bearerAuth.authorized) return bearerAuth.response
      canResolveRemote = true
    }

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
