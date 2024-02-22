import { NextRequest } from 'next/server'
import { generate } from 'peggy'

import { apiErrorResponse } from '@/lib/errors'
import { getStorage } from '@/lib/storage'
import { Scope } from '@/lib/storage/types/oauth'

import { AppRouterApiHandle, AppRouterParams } from './types'

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
  <P>(scope: Scope, handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const storage = await getStorage()
    if (!storage) {
      return apiErrorResponse(500)
    }

    const token = getTokenFromHeader(req.headers.get('Authorization'))
    if (!token) return apiErrorResponse(401)

    const accessToken = await storage.getAccessToken(token)
    if (!accessToken) return apiErrorResponse(401)

    const currentTime = Date.now()
    const tokenScopes = accessToken.scopes.map((scope) => scope.name)
    if (!tokenScopes.includes(scope)) return apiErrorResponse(401)
    if (accessToken.accessTokenExpiresAt.getTime() < currentTime) {
      return apiErrorResponse(401)
    }

    return handle(req, params)
  }
