import { NextRequest } from 'next/server'

import { Scope } from '@/lib/database/types/oauth'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { getUserInfo } from '@/lib/services/oauth/userinfo'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

export const GET = traceApiRoute(
  'getUserInfo',
  OAuthGuard([Scope.enum.read], async (req: NextRequest, context) => {
    const { currentActor } = context

    const userInfo = getUserInfo(currentActor)

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: userInfo
    })
  })
)
