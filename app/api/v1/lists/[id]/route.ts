import { z } from 'zod'

import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { Scope } from '@/lib/types/database/operations'
import { ListRepliesPolicy } from '@/lib/types/domain/list'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_404,
  ERROR_422,
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

// https://docs.joinmastodon.org/methods/lists/#get-one
export const GET = traceApiRoute(
  'getList',
  OAuthGuardAnyScope<Params>(
    [Scope.enum.read, Scope.enum['read:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const list = await database.getList({ id, actorId: currentActor.id })
      if (!list) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonList(list)
      })
    }
  )
)

const UpdateListBody = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  replies_policy: ListRepliesPolicy.optional(),
  exclusive: z.coerce.boolean().optional()
})

// https://docs.joinmastodon.org/methods/lists/#update
export const PUT = traceApiRoute(
  'updateList',
  OAuthGuard<Params>(
    [Scope.enum['write:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const json = await req.json().catch(() => null)
      const parsed = UpdateListBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const list = await database.updateList({
        id,
        actorId: currentActor.id,
        title: parsed.data.title,
        repliesPolicy: parsed.data.replies_policy,
        exclusive: parsed.data.exclusive
      })
      if (!list) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonList(list)
      })
    }
  )
)

// https://docs.joinmastodon.org/methods/lists/#delete
export const DELETE = traceApiRoute(
  'deleteList',
  OAuthGuard<Params>(
    [Scope.enum['write:lists']],
    async (req, { database, currentActor, params }) => {
      const { id } = await params
      const deleted = await database.deleteList({
        id,
        actorId: currentActor.id
      })
      if (!deleted) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_404,
          responseStatusCode: 404
        })
      }
      return apiResponse({ req, allowedMethods: CORS_HEADERS, data: {} })
    }
  )
)
