import { verifyAccessToken } from 'better-auth/oauth2'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { logger } from '@/lib/utils/logger'
import {
  HTTP_STATUS,
  StatusCode,
  apiErrorResponse,
  apiResponse,
  codeMap
} from '@/lib/utils/response'

import { isTrustedHeaderHost } from './headerHost'
import {
  AppRouterParams,
  AuthenticatedApiHandle,
  OptionalAuthenticatedApiHandle
} from './types'

// better-auth stores tokens as SHA-256 base64url (matching its defaultHasher)
const hashToken = (token: string): string => {
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

const hasGrantedScope = (grantedScopes: string[], requiredScope: Scope) => {
  if (grantedScopes.includes(requiredScope)) return true
  const parentScope = requiredScope.split(':')[0]
  return (
    parentScope !== requiredScope &&
    (parentScope === Scope.enum.read || parentScope === Scope.enum.write) &&
    grantedScopes.includes(parentScope)
  )
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

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const getOrigin = (value: string | null): string | null => {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

const isAllowedOrigin = (value: string | null, baseOrigin: string): boolean => {
  const origin = getOrigin(value)
  if (!origin) return false
  if (origin === baseOrigin) return true

  const originUrl = new URL(origin)
  const baseUrl = new URL(baseOrigin)
  return (
    originUrl.protocol === baseUrl.protocol &&
    isTrustedHeaderHost(originUrl.host)
  )
}

const hasSameOriginProof = (req: NextRequest): boolean => {
  if (!STATE_CHANGING_METHODS.has(req.method)) return true

  const baseOrigin = new URL(getBaseURL()).origin

  const origin = req.headers.get('Origin')
  if (origin) return isAllowedOrigin(origin, baseOrigin)

  const referer = req.headers.get('Referer')
  if (referer) return isAllowedOrigin(referer, baseOrigin)

  return false
}

type ScopeMatchMode = 'all' | 'any'

type GuardContext<P> = {
  currentActor: Actor
  database: NonNullable<ReturnType<typeof getDatabase>>
  params: Promise<P>
  grantedScopes?: string[]
}

const resolveAuthenticatedContext = async <P>({
  req,
  context,
  scopes,
  matchMode
}: {
  req: NextRequest
  context: AppRouterParams<P>
  scopes: Scope[]
  matchMode: ScopeMatchMode
}): Promise<
  | { authenticated: true; context: GuardContext<P> }
  | { authenticated: false; response?: Response }
> => {
  const database = getDatabase()
  if (!database) {
    return { authenticated: false, response: apiErrorResponse(500) }
  }

  const authorizationToken = req.headers.get('Authorization')
  if (isBearerAuthorizationHeader(authorizationToken)) {
    const token = getTokenFromHeader(authorizationToken)
    if (!token) {
      return { authenticated: false, response: apiErrorResponse(401) }
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
          jwtPayload = (await verifyAccessToken(token, {
            jwksUrl,
            // Scope hierarchy (for example read satisfying read:statuses) is
            // handled below so JWT and opaque tokens behave the same way.
            scopes: [],
            verifyOptions: {
              issuer: baseURL,
              audience: baseURL
            }
          })) as Record<string, unknown>
        } catch {
          // JWT verification failed (expired, invalid signature, wrong scope,
          // etc.) — reject immediately, do NOT fall through to opaque lookup
          return { authenticated: false, response: apiErrorResponse(401) }
        }

        const jwtScope = jwtPayload.scope as string | undefined
        const jwtScopes = jwtScope ? jwtScope.split(' ') : []
        grantedScopes = jwtScopes

        if (
          !hasRequiredScopes({ grantedScopes: jwtScopes, scopes, matchMode })
        ) {
          return { authenticated: false, response: apiErrorResponse(401) }
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
        return { authenticated: false, response: apiErrorResponse(401) }
      }

      // For opaque tokens, check expiration and scopes manually
      // (JWT verification already handles these for JWT tokens)
      if (!jwtPayload) {
        if (new Date(storedToken.expiresAt) < new Date()) {
          return { authenticated: false, response: apiErrorResponse(401) }
        }
        const storedScopes = parseStoredScopes(storedToken.scopes as string)
        grantedScopes = storedScopes

        if (
          !hasRequiredScopes({ grantedScopes: storedScopes, scopes, matchMode })
        ) {
          return { authenticated: false, response: apiErrorResponse(401) }
        }
      }

      // Extract actorId: from JWT claims or from stored referenceId (opaque)
      const actorId = jwtPayload
        ? (jwtPayload.actorId as string | null)
        : ((storedToken.referenceId as string | null) || null)

      let actor = actorId
        ? await database.getActorFromId({ id: actorId })
        : null

      if (!actor && !jwtPayload) {
        const accountId = (storedToken.userId as string | null) || null
        if (accountId) {
          // Better Auth opaque tokens store the authenticated account in userId
          // and leave referenceId blank. Resolve that account to its local
          // actor so Mastodon API bearer tokens work without a browser session.
          const actors = await database.getActorsForAccount({ accountId })
          actor = actors[0] ?? null
        }
      }

      if (!actor) {
        return { authenticated: false, response: apiErrorResponse(401) }
      }

      return {
        authenticated: true,
        context: {
          currentActor: Actor.parse(actor),
          database,
          params: context.params,
          grantedScopes
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

  return {
    authenticated: true,
    context: { currentActor, database, params: context.params }
  }
}

const createOAuthGuard =
  (matchMode: ScopeMatchMode) =>
  <P>(scopes: Scope[], handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const result = await resolveAuthenticatedContext({
      req,
      context,
      scopes,
      matchMode
    })
    if (!result.authenticated) {
      return result.response ?? apiErrorResponse(401)
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
      matchMode: options.matchMode ?? 'all'
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
