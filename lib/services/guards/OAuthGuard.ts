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
  async (req: NextRequest, params: AppRouterParams<P>) => {
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
      return handle(req, { currentActor, storage: database }, params)
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
      const accessToken = await storage.getAccessToken({
        accessToken: decoded.jti ?? ''
      })
      if (!accessToken) {
        return apiErrorResponse(401)
      }

      const tokenScopes = accessToken.scopes.map((scope) => scope.name)
      if (
        intersection(tokenScopes, scopes).length === 0 ||
        accessToken.accessTokenExpiresAt.getTime() < currentTime
      ) {
        return apiErrorResponse(401)
      }

      return handle(
        req,
        { currentActor: new Actor(accessToken.user.actor), storage },
        params
      )
    } catch (e) {
      const nodeErr = e as NodeJS.ErrnoException
      logger.error(nodeErr)
      return apiErrorResponse(500)
    }
  }
