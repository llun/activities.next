import { NextRequest } from 'next/server'

import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
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

const handleUserInfo = OAuthGuard(
  [Scope.enum.read],
  async (req: NextRequest, context) => {
    const { currentActor } = context

    const userInfo = getUserInfo(currentActor, currentActor.account)

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: userInfo
    })
  }
)

export const GET = traceApiRoute('getUserInfo', handleUserInfo)

export const POST = traceApiRoute('postUserInfo', handleUserInfo)
