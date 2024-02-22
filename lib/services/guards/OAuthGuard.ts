import { NextRequest } from 'next/server'

import { AppRouterApiHandle, AppRouterParams } from './types'

const BEARER_GRAMMAR = `

`

export const getTokenFromHeader = (authorizationHeader: string) => {}

export const OAuthGuard =
  <P>(handle: AppRouterApiHandle<P>) =>
  async (req: NextRequest, params?: AppRouterParams<P>) => {
    const authorizationHeader = req.headers.get('Authorization')
    if (!authorizationHeader) {
      return new Response('Unauthorized', { status: 401 })
    }
    return handle(req, params)
  }
