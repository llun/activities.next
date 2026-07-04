import { z } from 'zod'

import {
  OAuthGuard,
  OAuthGuardAnyScope
} from '@/lib/services/guards/OAuthGuard'
import { getMastodonList } from '@/lib/services/mastodon/getMastodonList'
import { Scope } from '@/lib/types/database/operations'
import { ListRepliesPolicy } from '@/lib/types/domain/list'
import { getRequestBody } from '@/lib/utils/getRequestBody'
import { HttpMethod } from '@/lib/utils/http-headers'
import { ERROR_422, apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { Booleanish } from '@/lib/utils/zodBooleanish'

const CORS_HEADERS = [
  HttpMethod.enum.OPTIONS,
  HttpMethod.enum.GET,
  HttpMethod.enum.POST
]

export const OPTIONS = defaultOptions(CORS_HEADERS)

// https://docs.joinmastodon.org/methods/lists/#get
export const GET = traceApiRoute(
  'getLists',
  OAuthGuardAnyScope(
    [Scope.enum.read, Scope.enum['read:lists']],
    async (req, { database, currentActor }) => {
      const lists = await database.getLists({ actorId: currentActor.id })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: lists.map(getMastodonList)
      })
    }
  )
)

const CreateListBody = z.object({
  title: z.string().trim().min(1).max(255),
  replies_policy: ListRepliesPolicy.optional(),
  exclusive: Booleanish.optional()
})

// https://docs.joinmastodon.org/methods/lists/#create
export const POST = traceApiRoute(
  'createList',
  OAuthGuard(
    [Scope.enum['write:lists']],
    async (req, { database, currentActor }) => {
      const json = await getRequestBody(req).catch(() => null)
      const parsed = CreateListBody.safeParse(json)
      if (!parsed.success) {
        return apiResponse({
          req,
          allowedMethods: CORS_HEADERS,
          data: ERROR_422,
          responseStatusCode: 422
        })
      }

      const list = await database.createList({
        actorId: currentActor.id,
        title: parsed.data.title,
        repliesPolicy: parsed.data.replies_policy,
        exclusive: parsed.data.exclusive
      })
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: getMastodonList(list)
      })
    }
  )
)
