import { NextRequest } from 'next/server'

import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getUserInfo } from '@/lib/services/oauth/userinfo'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const respondWithUserInfo = OAuthGuardAnyScope(
  [Scope.enum.openid, Scope.enum.read],
  async (req: NextRequest, context) => {
    const { currentActor, grantedScopes } = context

    const userInfo = getUserInfo({
      actor: currentActor,
      account: currentActor.account,
      scopes: grantedScopes
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: userInfo
    })
  }
)

export const GET = traceApiRoute('getUserInfo', respondWithUserInfo)

export const POST = traceApiRoute(
  'postUserInfo',
  async (req: NextRequest, context) => {
    const authHeader = req.headers.get('authorization')

    // OIDC Core §5.3.1: POST userinfo accepts access_token in form body
    if (!authHeader) {
      const contentType = req.headers.get('content-type') ?? ''
      if (contentType.includes('application/x-www-form-urlencoded')) {
        const formData = await req.clone().formData()
        const accessToken = formData.get('access_token')

        if (typeof accessToken === 'string' && accessToken.length > 0) {
          const headers = new Headers(req.headers)
          headers.set('authorization', `Bearer ${accessToken}`)
          const requestWithAuth = new NextRequest(req.url, {
            method: req.method,
            headers
          })
          return respondWithUserInfo(requestWithAuth, context)
        }
      }
    }

    return respondWithUserInfo(req, context)
  }
)
