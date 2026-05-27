import { z } from 'zod'

import { isCollectionPageUrl } from '@/lib/activities/getActorCollections'
import { getActorPerson } from '@/lib/activities/getActorPerson'
import { getActorPosts } from '@/lib/activities/getActorPosts'
import { OAuthGuard } from '@/lib/services/guards/OAuthGuard'
import { Scope } from '@/lib/types/database/operations'
import { cleanJson } from '@/lib/utils/cleanJson'
import { HttpMethod } from '@/lib/utils/http-headers'
import {
  ERROR_400,
  ERROR_404,
  apiResponse,
  defaultOptions
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const StatusQueryParams = z.object({
  page_url: z.string().url().optional()
})

export const GET = traceApiRoute(
  'getRemoteAccountStatuses',
  OAuthGuard<Params>([Scope.enum.read], async (req, context) => {
    const { database, currentActor, params } = context
    const encodedAccountId = (await params).id
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const url = new URL(req.url)
    const parsed = StatusQueryParams.safeParse(
      Object.fromEntries(url.searchParams.entries())
    )
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const actorId = idToUrl(encodedAccountId)
    const person = await getActorPerson({
      actorId,
      signingActor: currentActor
    })
    if (!person) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_404,
        responseStatusCode: 404
      })
    }

    if (
      parsed.data.page_url &&
      (!person.outbox ||
        !isCollectionPageUrl(parsed.data.page_url, person.outbox))
    ) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: ERROR_400,
        responseStatusCode: 400
      })
    }

    const result = await getActorPosts({
      database,
      person,
      signingActor: currentActor,
      pageUrl: parsed.data.page_url
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: {
        statuses: result.statuses.map((status) => cleanJson(status)),
        statusesCount: result.statusesCount,
        nextPageUrl: result.nextPageUrl,
        prevPageUrl: result.prevPageUrl
      }
    })
  }),
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
