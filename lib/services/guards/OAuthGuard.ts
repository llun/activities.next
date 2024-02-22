import { NextRequest } from 'next/server'
import { generate } from 'peggy'

import { AppRouterApiHandle, AppRouterParams } from './types'

const BEARER_GRAMMAR = `
value = "Bearer" " " token:base64 { return token }
base64 = front:(alpha / digit / other)+ padding:"="* { return [front.join(''), padding.join('')].join('') }
alpha = [a-zA-Z]
digit = [0-9]
other = [-._~+/]
`
const BEARER_PARSER = generate(BEARER_GRAMMAR)

export const getTokenFromHeader = (authorizationHeader: string) => {
  try {
    return BEARER_PARSER.parse(authorizationHeader)
  } catch {
    return null
  }
}

export const OAuthGuard =
  <P>(handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const authorizationHeader = req.headers.get('Authorization')
    if (!authorizationHeader) {
      return new Response('Unauthorized', { status: 401 })
    }
    return handle(req, params)
  }
