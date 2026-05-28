import { NextRequest } from 'next/server'

import {
  parseFilterBody,
  parseKeywordUpdateInput
} from '@/lib/services/filters/parseFilterInput'
import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonFilterKeyword } from '@/lib/services/mastodon/getMastodonFilter'
import { Scope } from '@/lib/types/database/operations'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
  HTTP_STATUS,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.PUT,
  HttpMethod.enum.DELETE
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

export const GET = traceApiRoute(
  'getFilterKeyword',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const keyword = await database.getFilterKeyword({
        actorId: currentActor.id,
        id
      })
      if (!keyword)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFilterKeyword(keyword)
      })
    }
  )
)

export const PUT = traceApiRoute(
  'updateFilterKeyword',
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
      const input = parseKeywordUpdateInput(rawBody)
      if (!input)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })

      const keyword = await database.updateFilterKeyword({
        actorId: currentActor.id,
        id,
        keyword: input.keyword,
        wholeWord: input.wholeWord
      })
      if (keyword === null)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      if (keyword === 'duplicate')
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY
        })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonFilterKeyword(keyword)
      })
    }
  )
)

export const DELETE = traceApiRoute(
  'deleteFilterKeyword',
  OAuthGuard<Params>(
    [Scope.enum['write:filters']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const keyword = await database.deleteFilterKeyword({
        actorId: currentActor.id,
        id
      })
      if (!keyword)
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: HTTP_STATUS.NOT_FOUND
        })
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
