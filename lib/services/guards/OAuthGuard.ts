import intersection from 'lodash/intersection'
import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'
import { generate } from 'peggy'

import { authOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { apiErrorResponse } from '@/lib/errors'
import { Actor } from '@/lib/models/actor'
import { getStorage } from '@/lib/storage'
import { Scope } from '@/lib/storage/types/oauth'

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
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const [storage, session] = await Promise.all([
      getStorage(),
      getServerSession(authOptions)
    ])

    if (!storage) {
      return apiErrorResponse(500)
    }

    if (session?.user?.email) {
      const currentActor = await storage.getActorFromEmail({
        email: session.user.email
      })
      if (!currentActor) return apiErrorResponse(401)
      return handle(req, { currentActor, storage }, params)
    }

    const token = getTokenFromHeader(req.headers.get('Authorization'))
    if (!token) return apiErrorResponse(401)

    const accessToken = await storage.getAccessToken(token)
    if (!accessToken) return apiErrorResponse(401)

    const currentTime = Date.now()
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
  }
