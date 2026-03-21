import { verifyAccessToken } from 'better-auth/oauth2'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

import { getBaseURL } from '@/lib/config'
import { getDatabase, getKnex } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'

import { AppRouterParams, AuthenticatedApiHandle } from './types'

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

export const getTokenFromHeader = (
  authorizationHeader: string | null
): string | null => {
  if (!authorizationHeader) return null
  const parts = authorizationHeader.split(' ')
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null
  return parts[1] || null
}

export const OAuthGuard =
  <P>(scopes: Scope[], handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const session = await getServerAuthSession()
    if (session?.user?.email) {
      const currentActor = await getActorFromSession(database, session)
      if (!currentActor) return apiErrorResponse(401)
      return handle(req, { currentActor, database, params: context.params })
    }

    const authorizationToken = req.headers.get('Authorization')
    const token = getTokenFromHeader(authorizationToken)
    if (!token) {
      return apiErrorResponse(401)
    }

    const baseURL = getBaseURL()
    const jwksUrl = `${baseURL}/api/auth/jwks`

    // Distinguish JWT from opaque tokens by format: JWTs have three
    // dot-separated segments. This prevents tampered/expired JWTs from
    // falling through to the opaque DB lookup path.
    let jwtPayload: Record<string, unknown> | null = null
    if (isJwtFormat(token)) {
      try {
        jwtPayload = (await verifyAccessToken(token, {
          jwksUrl,
          scopes,
          verifyOptions: {
            issuer: baseURL,
            audience: baseURL
          }
        })) as Record<string, unknown>
      } catch {
        // JWT verification failed (expired, invalid signature, wrong scope,
        // etc.) — reject immediately, do NOT fall through to opaque lookup
        return apiErrorResponse(401)
      }

      // Defense-in-depth: explicitly verify JWT scope claims in case
      // verifyAccessToken's scope checking changes in a future version
      const jwtScope = jwtPayload.scope as string | undefined
      const jwtScopes = jwtScope ? jwtScope.split(' ') : []
      for (const scope of scopes) {
        if (!jwtScopes.includes(scope)) {
          return apiErrorResponse(401)
        }
      }
    }

    try {
      // Verify the token exists in DB (revocation check for JWTs,
      // primary auth check for opaque tokens).
      const db = getKnex()
      const storedToken = await db('oauthAccessToken')
        .where('token', hashToken(token))
        .first()
      if (!storedToken) {
        return apiErrorResponse(401)
      }

      // For opaque tokens, check expiration and scopes manually
      // (JWT verification already handles these for JWT tokens)
      if (!jwtPayload) {
        if (new Date(storedToken.expiresAt) < new Date()) {
          return apiErrorResponse(401)
        }
        const storedScopes = parseStoredScopes(storedToken.scopes as string)
        for (const scope of scopes) {
          if (!storedScopes.includes(scope)) {
            return apiErrorResponse(401)
          }
        }
      }

      // Extract actorId: from JWT claims or from stored referenceId (opaque)
      const actorId = jwtPayload
        ? (jwtPayload.actorId as string | null)
        : (storedToken.referenceId as string | null)

      if (!actorId) {
        return apiErrorResponse(401)
      }

      const actor = await database.getActorFromId({ id: actorId })
      if (!actor) {
        return apiErrorResponse(401)
      }

      return handle(req, {
        currentActor: Actor.parse(actor),
        database,
        params: context.params
      })
    } catch (e) {
      logger.error(e as Error)
      return apiErrorResponse(500)
    }
  }
