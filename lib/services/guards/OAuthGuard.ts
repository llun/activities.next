import { verifyBearerToken } from 'better-auth/oauth2'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { isAccountConfirmationPending } from '@/lib/services/auth/canCreateSessionForAccount'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { oauthLogger } from '@/lib/services/oauth/logging'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { Client } from '@/lib/types/oauth2/client'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/http-headers'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiErrorResponse,
  apiResponse,
  codeMap
} from '@/lib/utils/response'
import { selectAccountActor } from '@/lib/utils/selectAccountActor'

import { hasSameOriginProof } from './sameOriginProof'
import { hasGrantedScope } from './scopeHierarchy'
import {
  AppRouterParams,
  AuthenticatedApiHandle,
  AuthenticatedAppApiHandle,
  OptionalAuthenticatedApiHandle
} from './types'

// better-auth stores tokens as SHA-256 base64url (matching its defaultHasher)
export const hashToken = (token: string): string => {
  const hash = crypto.createHash('sha256').update(token).digest()
  return hash
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// JWTs have three dot-separated base64url segments (header.payload.signature)
const isJwtFormat = (token: string): boolean => {
  const parts = token.split('.')
  return parts.length === 3 && parts.every((p) => p.length > 0)
}

const parseStoredScopes = (raw: string): string[] => {
  if (raw.startsWith('[')) {
    try {
      return JSON.parse(raw) as string[]
    } catch {
      return []
    }
  }
  return raw.split(' ')
}

const hasRequiredScopes = ({
  grantedScopes,
  scopes,
  matchMode
}: {
  grantedScopes: string[]
  scopes: Scope[]
  matchMode: ScopeMatchMode
}) => {
  if (scopes.length === 0) return false

  if (matchMode === 'all') {
    return scopes.every((scope) => hasGrantedScope(grantedScopes, scope))
  }
  return scopes.some((scope) => hasGrantedScope(grantedScopes, scope))
}

export const getTokenFromHeader = (
  authorizationHeader: string | null
): string | null => {
  if (!authorizationHeader) return null
  const parts = authorizationHeader.trim().split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1] || null
}

export const isBearerAuthorizationHeader = (
  authorizationHeader: string | null
): boolean =>
  authorizationHeader?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'bearer'

// A suspended actor, or an actor whose owning account is disabled, is blocked
// from every authenticated API surface (bearer and cookie). Silence is NOT
// checked here — silenced actors keep full API access; their statuses are only
// hidden from public timelines. Reads columns already present on the loaded
// domain Actor, so this adds no query to the hot auth path.
export const isActorModerationBlocked = (actor: Actor): boolean =>
  Boolean(actor.suspendedAt) || Boolean(actor.account?.disabledAt)

// An account whose confirmation e-mail has not been clicked yet may not act
// through a credential, which is the same answer Mastodon's `require_user!`
// gives ("Your login is missing a confirmed e-mail address", 403) before any
// API call runs. It matters because `POST /api/v1/accounts` hands out a real
// user access token the moment an account is registered: without this, an
// anonymous party holding only an app token can mint fully usable accounts for
// addresses nobody has proven they control.
//
// Reads a column already present on the loaded domain Actor, so this adds no
// query to the hot auth path. An actor with no account is left alone — the same
// direction `isActorModerationBlocked` fails in, and the only accountless local
// actor is the federation signing actor, which never authenticates.
export const isActorConfirmationPending = (actor: Actor): boolean => {
  const { account } = actor
  if (!account) return false
  return isAccountConfirmationPending(account)
}

type ScopeMatchMode = 'all' | 'any'

// Every failed bearer check answers with the same bare 401, which makes an
// authentication failure impossible to tell apart in production: an expired
// token, a revoked one, a scope mismatch and a grant with no actor all look
// identical. Record which check fired — never the token — so raising
// `LOG_LEVEL` to debug is enough to diagnose one.
const rejectBearer = (reason: string, statusCode: StatusCode) => {
  oauthLogger.debug(
    { endpoint: 'guard', reason, status: statusCode },
    `Bearer token rejected with ${statusCode}`
  )
  return apiErrorResponse(statusCode)
}

type GuardDatabase = NonNullable<ReturnType<typeof getDatabase>>

type GuardContext<P> = {
  currentActor: Actor
  database: GuardDatabase
  params: Promise<P>
  grantedScopes?: string[]
  // The OAuth client id behind a bearer token, when the request authenticated
  // via a token (not the web session). Lets handlers resolve the owning client
  // (e.g. to record the Mastodon "application" on a created status).
  clientId?: string | null
}

// Token-level context resolved before any actor is required. App
// (client_credentials) tokens have no actor, so actorId may be null here.
type TokenAuthContext = {
  grantedScopes: string[]
  actorId: string | null
  clientId: string | null
  // The account the token was issued for. App (client_credentials) tokens have
  // none; a user token always does, even when the grant recorded no actor.
  userId: string | null
}

// The actor an account acts as when a token carries no actor reference of its
// own. Only reached on that fallback path, so the two extra reads stay off the
// hot auth path.
const resolveAccountActorId = async (
  database: GuardDatabase,
  accountId: string | null
): Promise<string | null> => {
  if (!accountId) return null

  const [account, actors] = await Promise.all([
    database.getAccountFromId({ id: accountId }),
    database.getActorsForAccount({ accountId })
  ])
  return selectAccountActor(actors, account?.defaultActorId)?.id ?? null
}

// Validates a bearer token (JWT or opaque): jwks verification, DB existence
// (revocation), expiry, and scope checks — but does NOT require or resolve an
// actor. Callers add the actor-resolution step on top. Precondition: the
// caller has already confirmed an `Authorization: Bearer …` header is present.
const resolveTokenContext = async ({
  req,
  scopes,
  matchMode
}: {
  req: NextRequest
  scopes: Scope[]
  matchMode: ScopeMatchMode
}): Promise<
  | { valid: true; context: TokenAuthContext; database: GuardDatabase }
  | { valid: false; response: Response }
> => {
  const database = getDatabase()
  if (!database) {
    return { valid: false, response: apiErrorResponse(500) }
  }

  const token = getTokenFromHeader(req.headers.get('Authorization'))
  if (!token) {
    return {
      valid: false,
      response: rejectBearer('malformed_authorization_header', 401)
    }
  }

  const baseURL = getBaseURL()
  const jwksUrl = `${baseURL}/api/auth/jwks`

  // Distinguish JWT from opaque tokens by format: JWTs have three
  // dot-separated segments. This prevents tampered/expired JWTs from
  // falling through to the opaque DB lookup path.
  let jwtPayload: Record<string, unknown> | null = null
  let grantedScopes: string[] = []

  try {
    if (isJwtFormat(token)) {
      try {
        // Scope hierarchy (for example read satisfying read:statuses) is
        // handled below so JWT and opaque tokens behave the same way, so no
        // `requiredScopes` are passed here. `verifyBearerToken` is better-auth
        // 1.7's successor to `verifyAccessToken`; it additionally rejects
        // DPoP-bound tokens presented as plain bearer tokens, which this
        // resource server has no way to sender-constrain. (`verifyJwsAccessToken`,
        // which the compiler suggests on the rename, is NOT the equivalent — it
        // takes `jwksFetch` rather than `jwksUrl` and skips that check.)
        jwtPayload = (await verifyBearerToken(token, {
          jwksUrl,
          verifyOptions: {
            issuer: baseURL,
            audience: baseURL
          }
        })) as Record<string, unknown>
      } catch {
        // JWT verification failed (expired, invalid signature, wrong scope,
        // etc.) — reject immediately, do NOT fall through to opaque lookup
        return {
          valid: false,
          response: rejectBearer('jwt_verification_failed', 401)
        }
      }

      const jwtScope = jwtPayload.scope as string | undefined
      const jwtScopes = jwtScope ? jwtScope.split(' ') : []
      grantedScopes = jwtScopes

      if (!hasRequiredScopes({ grantedScopes: jwtScopes, scopes, matchMode })) {
        return {
          valid: false,
          response: rejectBearer('insufficient_scope', 401)
        }
      }
    }

    // Verify the token exists in DB (revocation check for JWTs,
    // primary auth check for opaque tokens).
    // better-auth's storeToken() hashes ALL token types (JWT and opaque)
    // via defaultHasher (SHA-256 base64url) before storing in the
    // oauthAccessToken.token column.
    // See: @better-auth/oauth-provider/dist/utils-DgozotLg.mjs storeToken()
    const db = getKnex()
    const storedToken = await db('oauthAccessToken')
      .where('token', hashToken(token))
      .first()
    if (!storedToken) {
      return { valid: false, response: rejectBearer('token_not_found', 401) }
    }

    // For opaque tokens, check expiration and scopes manually
    // (JWT verification already handles these for JWT tokens)
    if (!jwtPayload) {
      if (new Date(storedToken.expiresAt) < new Date()) {
        return { valid: false, response: rejectBearer('token_expired', 401) }
      }
      // Fall back to an empty scope string if the column is null/undefined so
      // parseStoredScopes can't throw — a scopeless token then fails the scope
      // check with 401 rather than surfacing a 500.
      const storedScopes = parseStoredScopes(
        (storedToken.scopes as string | null) ?? ''
      )
      grantedScopes = storedScopes

      if (
        !hasRequiredScopes({ grantedScopes: storedScopes, scopes, matchMode })
      ) {
        return {
          valid: false,
          response: rejectBearer('insufficient_scope', 401)
        }
      }
    }

    // Extract actorId: from JWT claims or from stored referenceId (opaque).
    // App (client_credentials) tokens have no actor — the JWT actorId claim is
    // absent (undefined) and the opaque referenceId is null/empty — so
    // normalize both to null to honor the string | null context type.
    const actorId = jwtPayload
      ? (jwtPayload.actorId as string | null | undefined) || null
      : (storedToken.referenceId as string | null) || null

    // storedToken is always fetched above (revocation check) for both JWT and
    // opaque tokens, so clientId is available without an extra query.
    const clientId = (storedToken.clientId as string | null) || null

    return {
      valid: true,
      context: {
        grantedScopes,
        actorId,
        clientId,
        userId: (storedToken.userId as string | null) || null
      },
      database
    }
  } catch (e) {
    logger.error(e as Error)
    return { valid: false, response: apiErrorResponse(500) }
  }
}

// Endpoints that must still reach an account awaiting confirmation opt in with
// `allowUnconfirmedAccount`. There is exactly one — resending its own
// confirmation e-mail — and Mastodon carves out the same endpoint
// (`Api::V1::Emails::ConfirmationsController` never calls `require_user!`).
// Blocking it everywhere would make the pending state unrecoverable for a
// client that lost the e-mail. It relaxes the confirmation test and NOTHING
// else: a suspended actor or a disabled account is still refused, because
// `isActorModerationBlocked` runs regardless.
type AccountStateOptions = { allowUnconfirmedAccount?: boolean }

const resolveAuthenticatedContext = async <P>({
  req,
  context,
  scopes,
  matchMode,
  allowUnconfirmedAccount = false
}: {
  req: NextRequest
  context: AppRouterParams<P>
  scopes: Scope[]
  matchMode: ScopeMatchMode
} & AccountStateOptions): Promise<
  | { authenticated: true; context: GuardContext<P> }
  | { authenticated: false; response?: Response }
> => {
  const database = getDatabase()
  if (!database) {
    return { authenticated: false, response: apiErrorResponse(500) }
  }

  const authorizationToken = req.headers.get('Authorization')
  if (isBearerAuthorizationHeader(authorizationToken)) {
    const tokenResult = await resolveTokenContext({ req, scopes, matchMode })
    if (!tokenResult.valid) {
      return { authenticated: false, response: tokenResult.response }
    }

    const { actorId, clientId, grantedScopes, userId } = tokenResult.context

    try {
      // A grant that resolved no actor reference (see
      // `resolveConsentReferenceId`) leaves the token with no actorId, which
      // would 401 every bearer route it is presented to until the client
      // re-authorizes. Resolve the account's actor the same way the browser
      // session does so an already-issued token recovers on its own. App
      // (client_credentials) tokens carry no user and stay actor-less.
      const resolvedActorId =
        actorId ?? (await resolveAccountActorId(database, userId))
      if (!resolvedActorId) {
        return {
          authenticated: false,
          response: rejectBearer('no_actor_for_token', 401)
        }
      }

      const actor = await database.getActorFromId({ id: resolvedActorId })
      if (!actor) {
        return {
          authenticated: false,
          response: rejectBearer('actor_not_found', 401)
        }
      }
      const parsedActor = Actor.parse(actor)
      if (isActorModerationBlocked(parsedActor)) {
        return {
          authenticated: false,
          response: rejectBearer('actor_moderation_blocked', 403)
        }
      }
      if (!allowUnconfirmedAccount && isActorConfirmationPending(parsedActor)) {
        return {
          authenticated: false,
          response: rejectBearer('account_unconfirmed', 403)
        }
      }

      return {
        authenticated: true,
        context: {
          currentActor: parsedActor,
          database,
          params: context.params,
          grantedScopes,
          clientId
        }
      }
    } catch (e) {
      logger.error(e as Error)
      return { authenticated: false, response: apiErrorResponse(500) }
    }
  }

  const session = await getServerAuthSession()
  if (!session?.user?.email) {
    return { authenticated: false }
  }

  if (!hasSameOriginProof(req)) {
    return { authenticated: false, response: apiErrorResponse(403) }
  }

  const currentActor = await getActorFromSession(database, session)
  if (!currentActor) {
    return { authenticated: false, response: apiErrorResponse(401) }
  }
  if (isActorModerationBlocked(currentActor)) {
    return { authenticated: false, response: apiErrorResponse(403) }
  }
  if (!allowUnconfirmedAccount && isActorConfirmationPending(currentActor)) {
    return { authenticated: false, response: apiErrorResponse(403) }
  }

  return {
    authenticated: true,
    context: { currentActor, database, params: context.params }
  }
}

const createOAuthGuard =
  (matchMode: ScopeMatchMode) =>
  <P>(
    scopes: Scope[],
    handle: AuthenticatedApiHandle<P>,
    options: {
      errorResponse?: (req: NextRequest, statusCode: StatusCode) => Response
    } & AccountStateOptions = {}
  ) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const result = await resolveAuthenticatedContext({
      req,
      context,
      scopes,
      matchMode,
      allowUnconfirmedAccount: options.allowUnconfirmedAccount
    })
    if (!result.authenticated) {
      const response = result.response ?? apiErrorResponse(401)
      // Let CORS-enabled routes attach their allowed-method CORS headers to the
      // guard's 401/403/500 responses so cross-origin clients can read the
      // error instead of seeing an opaque browser CORS failure.
      return options.errorResponse
        ? options.errorResponse(req, response.status as StatusCode)
        : response
    }

    return handle(req, result.context)
  }

/**
 * Requires ALL specified scopes to be present on the token.
 */
export const OAuthGuard = createOAuthGuard('all')

/**
 * Requires at least ONE of the specified scopes to be present on the token.
 */
export const OAuthGuardAnyScope = createOAuthGuard('any')

/**
 * Bearer-only guard for app-level (client_credentials) endpoints. Validates the
 * token + scopes like OAuthGuard, but does NOT fall back to the cookie session
 * and does NOT require an actor: it resolves the actor only when the token
 * carries one, and always surfaces the owning client. Use for Mastodon
 * endpoints (e.g. apps/verify_credentials) that must accept app tokens with no
 * associated user/actor.
 */
export const OAuthAppGuard =
  <P>(
    scopes: Scope[],
    handle: AuthenticatedAppApiHandle<P>,
    options: {
      errorResponse?: (req: NextRequest, statusCode: StatusCode) => Response
      matchMode?: ScopeMatchMode
    } & AccountStateOptions = {}
  ) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const fail = (response: Response) =>
      options.errorResponse
        ? options.errorResponse(req, response.status as StatusCode)
        : response

    const authorizationToken = req.headers.get('Authorization')
    if (!isBearerAuthorizationHeader(authorizationToken)) {
      return fail(apiErrorResponse(401))
    }

    const tokenResult = await resolveTokenContext({
      req,
      scopes,
      matchMode: options.matchMode ?? 'all'
    })
    if (!tokenResult.valid) {
      return fail(tokenResult.response)
    }

    const { database } = tokenResult
    const { actorId, clientId, grantedScopes, userId } = tokenResult.context

    let currentActor: Actor | null = null
    let client: Client | null = null
    try {
      // A token that delegates an actor must resolve to a live actor. If the
      // actor was deleted, fail safe with 401 rather than silently downgrading
      // to an actor-less (app-level) context. A user token whose grant recorded
      // no actor reference recovers through the account, matching the
      // user-facing guard. Genuine app (client_credentials) tokens have neither
      // an actor nor a user and skip this entirely.
      const resolvedActorId =
        actorId ?? (await resolveAccountActorId(database, userId))
      if (resolvedActorId) {
        const actor = await database.getActorFromId({ id: resolvedActorId })
        if (!actor) {
          return fail(rejectBearer('actor_not_found', 401))
        }
        currentActor = Actor.parse(actor)
        if (isActorModerationBlocked(currentActor)) {
          return fail(rejectBearer('actor_moderation_blocked', 403))
        }
        if (
          !options.allowUnconfirmedAccount &&
          isActorConfirmationPending(currentActor)
        ) {
          return fail(rejectBearer('account_unconfirmed', 403))
        }
      }

      // Resolve the owning client by id (an indexed primary-key lookup) rather
      // than re-hashing the token and joining oauthAccessToken again. Re-parse
      // at the guard boundary for the same defensive validation applied to
      // currentActor above.
      if (clientId) {
        const clientRow = await database.getClientFromId({ clientId })
        client = clientRow ? Client.parse(clientRow) : null
      }
    } catch (e) {
      // Mirror resolveAuthenticatedContext: a DB error during actor/client
      // resolution returns a clean 500 instead of an unhandled rejection.
      logger.error(e as Error)
      return fail(apiErrorResponse(500))
    }

    return handle(req, {
      currentActor,
      client,
      grantedScopes,
      database,
      params: context.params,
      // See `AuthenticatedAppApiHandle`'s `userId` field for why this, and not
      // `currentActor`, is what tells an app token from a user token.
      userId
    })
  }

export const corsErrorResponse =
  (allowedMethods: HttpMethod[]) =>
  (req: NextRequest, responseStatusCode: StatusCode) =>
    apiResponse({
      req,
      allowedMethods,
      data: codeMap[responseStatusCode],
      responseStatusCode
    })

export const OptionalOAuthGuard =
  <P>(
    scopes: Scope[],
    handle: OptionalAuthenticatedApiHandle<P>,
    options: {
      errorResponse?: (req: NextRequest, statusCode: StatusCode) => Response
      matchMode?: ScopeMatchMode
    } = {}
  ) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const result = await resolveAuthenticatedContext({
      req,
      context,
      scopes,
      matchMode: options.matchMode ?? 'all',
      // Optional-auth routes do NOT apply the confirmation gate, and this is
      // the one place the moderation check and the confirmation check
      // deliberately diverge. Mastodon's equivalent of this guard is
      // `authorize_if_got_token!`, which validates the token and scope and
      // never calls `require_user!`; only `require_not_suspended!` is applied
      // globally, which is what `isActorModerationBlocked` mirrors. Without
      // this, presenting a valid-but-unconfirmed token to a public endpoint
      // (`timelines/public`, `statuses/:id`, search, …) answered a hard 403,
      // where sending NO Authorization header at all succeeded — a token made
      // the request fail. Everything that actually requires a user still runs
      // through the mandatory guards, which do apply the gate.
      allowUnconfirmedAccount: true
    })

    if (result.authenticated) {
      return handle(req, result.context)
    }

    if (result.response) {
      return options.errorResponse
        ? options.errorResponse(req, result.response.status as StatusCode)
        : result.response
    }

    const database = getDatabase()
    if (!database) {
      return options.errorResponse
        ? options.errorResponse(req, HTTP_STATUS.INTERNAL_SERVER_ERROR)
        : apiErrorResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR)
    }

    return handle(req, {
      currentActor: null,
      database,
      params: context.params
    })
  }
