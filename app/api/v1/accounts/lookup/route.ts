import { NextRequest } from 'next/server'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import {
  recordRemoteActorBestEffort,
  refreshKnownRemoteActor
} from '@/lib/services/actors/refreshRemoteActor'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import {
  OptionalOAuthGuard,
  corsErrorResponse,
  isBearerAuthorizationHeader
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
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

  // Remote fetches (resolving an unknown handle, or refreshing a known remote
  // actor) require an authenticated viewer: the web session, or a bearer token
  // carrying a read scope. Resolved lazily (and once) so lookups that never
  // need a remote fetch skip the auth work.
  const hasBearerAuthorization = isBearerAuthorizationHeader(
    req.headers.get('Authorization')
  )
  type RemoteFetchAuth =
    { authorized: true } | { authorized: false; bearerResponse?: Response }
  let cachedRemoteFetchAuth: RemoteFetchAuth | null = null
  const getRemoteFetchAuth = async (): Promise<RemoteFetchAuth> => {
    if (cachedRemoteFetchAuth) return cachedRemoteFetchAuth
    let auth: RemoteFetchAuth
    if (!hasBearerAuthorization) {
      const session = await getServerAuthSession()
      auth = { authorized: Boolean(session?.user?.email) }
    } else {
      const bearerAuth = await authorizeBearerRemoteLookup(req)
      auth = bearerAuth.authorized
        ? { authorized: true }
        : { authorized: false, bearerResponse: bearerAuth.response }
    }
    cachedRemoteFetchAuth = auth
    return auth
  }

  // A presented bearer is validated up front, matching the guarded routes
  // (OptionalOAuthGuard rejects an invalid token instead of downgrading it to
  // anonymous): an expired-token client gets a 401 re-auth signal here rather
  // than a silently-stale profile with the refresh skipped.
  if (hasBearerAuthorization) {
    const auth = await getRemoteFetchAuth()
    if (!auth.authorized && auth.bearerResponse) return auth.bearerResponse
  }

  let actor = await database.getActorFromUsername({ username, domain })

  if (actor) {
    // Profile headers are commonly built from this endpoint's response, so a
    // known remote actor is refreshed (stale profile + counter sync) before
    // serialization — otherwise clients keep seeing zeroed counts until some
    // other endpoint happens to refresh the actor. No-op for recently-synced
    // actors; failures fall back to the stored actor. Internal actors skip
    // even the auth check — nothing to refresh.
    const isInternal = Boolean(actor.account || actor.privateKey)
    if (!isInternal && (await getRemoteFetchAuth()).authorized) {
      actor = await refreshKnownRemoteActor({ database, actor })
    }
  } else if (resolve && domain !== config.host) {
    // An invalid bearer already returned above, so an unauthorized viewer
    // here is credential-less and gets the same 404 an unresolvable handle
    // would.
    if (!(await getRemoteFetchAuth()).authorized) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    const actorId = await getWebfingerSelf({ account: `${username}@${domain}` })
    actor = actorId
      ? await recordRemoteActorBestEffort({ actorId, database })
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

  return apiResponse({
    req,
    allowedMethods: CORS_HEADERS,
    data: localizeAccount(mastodonActor, headerHost(req.headers))
  })
})
