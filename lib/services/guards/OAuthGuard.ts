import jwt from 'jsonwebtoken'
import intersection from 'lodash/intersection'
import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'
import { generate } from 'peggy'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getConfig } from '@/lib/config'
import { getDatabase } from '@/lib/database'
import { Scope } from '@/lib/database/types/oauth'
import { Actor } from '@/lib/models/actor'
import { logger } from '@/lib/utils/logger'
import { apiErrorResponse } from '@/lib/utils/response'

import { AppRouterParams, AuthenticatedApiHandle } from './types'

const BEARER_GRAMMAR = `
value = "Bearer" " " token:base64 { return token }
base64 = front:(alpha / digit / other)+ padding:"="* { return [front.join(''), padding.join('')].join('') }
alpha = [a-zA-Z]
digit = [0-9]
other = [-._~+/]
`
const BEARER_PARSER = generate(BEARER_GRAMMAR)

export const getTokenFromHeader = (authorizationHeader: string | null) => {
  try {
    return BEARER_PARSER.parse(authorizationHeader ?? '')
  } catch {
    return null
  }
}

export const OAuthGuard =
  <P>(scopes: Scope[], handle: AuthenticatedApiHandle<P>) =>
  async (req: NextRequest, context: AppRouterParams<P>) => {
    const database = getDatabase()
    if (!database) {
      return apiErrorResponse(500)
    }

    const session = await getServerSession(getAuthOptions())
    if (session?.user?.email) {
      const currentActor = await database.getActorFromEmail({
        email: session.user.email
      })
      if (!currentActor) return apiErrorResponse(401)
      return handle(req, { currentActor, database, params: context.params })
    }

    const authorizationToken = req.headers.get('Authorization')
    const token = getTokenFromHeader(authorizationToken)
    if (!token) {
      return apiErrorResponse(401)
    }

    try {
      const currentTime = Date.now()
      const decoded = jwt.verify(
        token,
        getConfig().secretPhase
      ) as jwt.JwtPayload
      const accessToken = await database.getAccessToken({
        accessToken: decoded.jti ?? ''
      })
      // This is guard for user access token
      if (!accessToken || !accessToken.user) {
        return apiErrorResponse(401)
      }

      const tokenScopes = accessToken.scopes.map((scope) => scope.name)
      if (
        intersection(tokenScopes, scopes).length === 0 ||
        accessToken.accessTokenExpiresAt.getTime() < currentTime
      ) {
        return apiErrorResponse(401)
      }

      // Sliding session: extend tokens when within 1 day of expiry
      const ONE_DAY_MS = 24 * 60 * 60 * 1000
      const timeUntilExpiry =
        accessToken.accessTokenExpiresAt.getTime() - currentTime
      if (timeUntilExpiry <= ONE_DAY_MS) {
        const sevenDaysFromNow = currentTime + 7 * ONE_DAY_MS
        const thirtyDaysFromNow = currentTime + 30 * ONE_DAY_MS
        database
          .touchAccessToken({
            accessToken: decoded.jti ?? '',
            accessTokenExpiresAt: sevenDaysFromNow,
            refreshTokenExpiresAt: thirtyDaysFromNow
          })
          .catch(() => {}) // Fire-and-forget, don't block the request
      }

      return handle(req, {
        currentActor: Actor.parse(accessToken.user.actor),
        database,
        params: context.params
      })
    } catch (e) {
      const nodeErr = e as NodeJS.ErrnoException
      if (nodeErr.message === 'jwt expired') {
        return apiErrorResponse(401)
      }

      logger.error(nodeErr)
      return apiErrorResponse(500)
    }
  }
