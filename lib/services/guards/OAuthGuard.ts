import { verifyAccessToken } from 'better-auth/oauth2'
import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { Scope } from '@/lib/types/database/operations'
import { Actor } from '@/lib/types/domain/actor'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'

import { AppRouterParams, AuthenticatedApiHandle } from './types'

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

    try {
      const config = getConfig()
      const baseURL = config.host.startsWith('http')
        ? config.host
        : `${process.env.ACTIVITIES_INSECURE_AUTH === 'true' ? 'http' : 'https'}://${config.host}`

      const jwksUrl = `${baseURL}/api/auth/jwks`

      const payload = await verifyAccessToken(token, {
        jwksUrl,
        scopes,
        verifyOptions: {
          issuer: baseURL,
          audience: baseURL
        }
      })

      // Extract actorId from JWT claims
      const actorId = (payload as Record<string, unknown>).actorId as
        | string
        | null

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
      const err = e as Error
      if (err.message === 'token expired' || err.message === 'token invalid') {
        return apiErrorResponse(401)
      }

      logger.error(err)
      return apiErrorResponse(401)
    }
  }
