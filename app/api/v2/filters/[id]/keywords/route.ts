import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseKeywordCreateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonFilterKeyword } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_422,
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'listFilterKeywords',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const keywords = await database.getFilterKeywords({
        actorId: currentActor.id,
        filterId: id
      })
      if (!keywords) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: keywords.map(getMastodonFilterKeyword)
      })
    }
  )
)

export const POST = traceApiRoute(
  'addFilterKeyword',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req: NextRequest, { database, currentActor, params }) => {
      const { id } = await params
      let rawBody: unknown
      try {
        rawBody = await parseFilterBody(req)
      } catch {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      }
      const input = parseKeywordCreateInput(rawBody)
      if (!input)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const keyword = await database.addFilterKeyword({
        actorId: currentActor.id,
        filterId: id,
        keyword: input.keyword,
        wholeWord: input.wholeWord
      })
      if (!keyword) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFilterKeyword(keyword)
      })
    }
  )
)
