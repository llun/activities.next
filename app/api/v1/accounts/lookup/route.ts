import { NextRequest } from 'next/server'

import { getWebfingerSelf } from '@/lib/activities/getWebfingerSelf'
import { getDatabase } from '@/lib/database'
import { localizeAccount } from '@/lib/services/accounts/localizeAccount'
import {
  recordRemoteActorBestEffort,
  refreshKnownRemoteActor
} from '@/lib/services/actors/refreshRemoteActor'
import {
  parseBlueskyProfileInput,
  resolveBlueskyProfile
} from '@/lib/services/bluesky/profiles'
import { isLocalDomain } from '@/lib/services/domains/localDomains'
import {
  OptionalOAuthGuard,
  corsErrorResponse,
  isBearerAuthorizationHeader
} from '@/lib/services/guards/OAuthGuard'
import { headerHost } from '@/lib/services/guards/headerHost'
import { resolveOptionalSessionActor } from '@/lib/services/guards/sessionActor'
import { Scope } from '@/lib/types/database/operations'
import type { Actor } from '@/lib/types/domain/actor'
import { parseAccountUrlHandle } from '@/lib/utils/accountHandle'
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
  const trimmed = value.trim()
  if (/^https?:\/\//i.test(trimmed)) {
    const urlHandle = parseAccountUrlHandle(trimmed)
    return urlHandle ?? null
  }

  const normalized = trimmed.replace(/^@/, '')
  const segments = normalized.split('@')
  if (segments.length > 2) return null

  const [username, domain] =
    segments.length === 2 ? segments : [segments[0], localDomain]
  if (!username || !domain) return null

  return { username, domain }
}

const authorizeBearerRemoteLookup = async (req: NextRequest) => {
  let authorizedActor: Actor | null = null
  let reachedHandler = false
  const response = await OptionalOAuthGuard(
    [Scope.enum.read, Scope.enum['read:accounts']],
    // Read the IDENTITY, never the fact that the handler ran. This guard also
    // invokes its handler on the anonymous fall-through — for a request with no
    // token at all, and for one whose account has not confirmed its e-mail,
    // which it downgrades rather than refusing. Treating invocation as
    // authorization let an unconfirmed account make this instance issue
    // WebFinger lookups and signed remote fetches at addresses of its choosing.
    async (_req, { currentActor }) => {
      reachedHandler = true
      authorizedActor = currentActor
      return new Response(null, { status: 204 })
    },
    {
      errorResponse: corsErrorResponse(CORS_HEADERS),
      matchMode: 'any'
    }
  )(req, { params: Promise.resolve({}) })

  // Only a response the GUARD produced is worth forwarding to the client — the
  // 401 or 403 it answers a bad token with. The 204 above is this function's
  // own probe, and forwarding it would answer the lookup with an empty body
  // the moment an unauthorized-but-valid caller reached the handler.
  return {
    authorizedActor,
    response: reachedHandler ? undefined : response
  }
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

  const host = headerHost(req.headers)
  const trimmedAcct = acct.trim()
  const actorFromId = /^https?:\/\//i.test(trimmedAcct)
    ? await database.getActorFromId({ id: trimmedAcct })
    : null
  const handle = actorFromId ? null : parseAccountHandle(trimmedAcct, host)
  // A Bluesky handle (`handle@bsky.app`) or bsky.app profile link a linked
  // Bluesky account can resolve below; a bare name stays a local username.
  const blueskyQuery =
    !actorFromId &&
    (handle?.domain.toLowerCase() === 'bsky.app' ||
      /^https?:\/\//i.test(trimmedAcct)) &&
    parseBlueskyProfileInput(trimmedAcct) !== null

  if (!handle && !actorFromId && !blueskyQuery)
    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: ERROR_400,
      responseStatusCode: 400
    })

  // Remote fetches (resolving an unknown handle, or refreshing a known remote
  // actor) require an authenticated viewer: the web session, or a bearer token
  // carrying a read scope. Resolved lazily (and once) so lookups that never
  // need a remote fetch skip the auth work.
  const hasBearerAuthorization = isBearerAuthorizationHeader(
    req.headers.get('Authorization')
  )
  type RemoteFetchAuth =
    | { authorized: true; actor: Actor }
    | { authorized: false; bearerResponse?: Response }
  let cachedRemoteFetchAuth: RemoteFetchAuth | null = null
  const getRemoteFetchAuth = async (): Promise<RemoteFetchAuth> => {
    if (cachedRemoteFetchAuth) return cachedRemoteFetchAuth
    let auth: RemoteFetchAuth
    if (!hasBearerAuthorization) {
      // Resolve the ACTOR and apply the same state checks a guard would, rather
      // than trusting the mere existence of a session. A session is not
      // re-validated after it is created, so a cohort account that signs in and
      // then re-points its own address — which makes it pending — kept driving
      // outbound WebFinger and signed remote fetches here through the session
      // it already held, which is exactly the capability this route's bearer
      // branch withholds from a pending account. The same gap let a suspended
      // account's lingering session through.
      const sessionActor = await resolveOptionalSessionActor(database)
      auth = sessionActor
        ? { authorized: true, actor: sessionActor }
        : { authorized: false }
    } else {
      const bearerAuth = await authorizeBearerRemoteLookup(req)
      auth = bearerAuth.authorizedActor
        ? { authorized: true, actor: bearerAuth.authorizedActor }
        : { authorized: false, bearerResponse: bearerAuth.response }
    }
    cachedRemoteFetchAuth = auth
    return auth
  }

  // A presented bearer is validated up front, matching the guarded routes: an
  // expired or revoked token gets a 401 re-auth signal here rather than a
  // silently-stale profile with the refresh skipped. A token whose account is
  // merely unconfirmed is NOT such a case — the guard downgrades it to
  // anonymous, so it resolves no actor, `authorized` stays false, and the
  // request is answered exactly as an anonymous one is.
  if (hasBearerAuthorization) {
    const auth = await getRemoteFetchAuth()
    if (!auth.authorized && auth.bearerResponse) return auth.bearerResponse
  }

  let actor =
    actorFromId ?? (handle ? await database.getActorFromUsername(handle) : null)

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
  } else if (resolve && blueskyQuery) {
    // Resolved through the viewer's linked Bluesky account; without one (or
    // signed out) the answer is the 404 an unresolvable handle gets.
    const auth = await getRemoteFetchAuth()
    const blueskyId = auth.authorized
      ? await resolveBlueskyProfile(database, auth.actor, trimmedAcct)
      : null
    actor = blueskyId ? await database.getActorFromId({ id: blueskyId }) : null
  } else if (
    resolve &&
    handle &&
    !(await isLocalDomain(database, handle.domain))
  ) {
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

    const actorId = await getWebfingerSelf({
      account: `${handle.username}@${handle.domain}`
    })
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
    data: localizeAccount(mastodonActor, host)
  })
})
