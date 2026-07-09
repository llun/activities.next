import { NextRequest } from 'next/server'

import { getConfig } from '@/lib/config'
import { AUTH_BASE_PATH } from '@/lib/services/auth/constants'
import { resolveAuthBaseURL } from '@/lib/services/auth/requestOrigin'
import { OAuthGuardAnyScope } from '@/lib/services/guards/OAuthGuard'
import { getUserInfo } from '@/lib/services/oauth/userinfo'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import { HTTP_STATUS, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

const respondWithUserInfo = OAuthGuardAnyScope(
  [Scope.enum.openid, Scope.enum.read, Scope.enum.profile],
  async (req: NextRequest, context) => {
    const { currentActor, grantedScopes } = context

    // The OIDC `sub` is the owning account id, so the actor resolved from the
    // access token must carry its account. A token issued through the OAuth
    // consent flow always maps to a local actor with an account; a missing one
    // is an unexpected state we fail closed on rather than emit a `sub`-less
    // (spec-invalid) userinfo response.
    const account = currentActor.account
    if (!account) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'invalid_token' },
        responseStatusCode: HTTP_STATUS.UNAUTHORIZED
      })
    }

    const userInfo = getUserInfo({
      actor: currentActor,
      account,
      // Same issuer the discovery document advertises (and better-auth stamps
      // into id_tokens): the validated per-request origin + auth basePath, so
      // a relying party can match userinfo `iss` against the id_token `iss`.
      issuer: `${resolveAuthBaseURL(req.headers, getConfig())}${AUTH_BASE_PATH}`,
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
