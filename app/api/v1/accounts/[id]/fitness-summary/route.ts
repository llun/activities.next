import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getDatabase } from '@/lib/database'
import { getServerAuthSession } from '@/lib/services/auth/getSession'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import { apiResponse, defaultOptions } from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'
import { idToUrl } from '@/lib/utils/urlToId'

const CORS_HEADERS = [HttpMethod.enum.OPTIONS, HttpMethod.enum.GET]

export const OPTIONS = defaultOptions(CORS_HEADERS)

interface Params {
  id: string
}

const MIN_DATE_RANGE_MS = 7 * 24 * 60 * 60 * 1000

const FitnessSummaryQueryParams = z.object({
  start_date: z.coerce.number(),
  end_date: z.coerce.number()
})

export const GET = traceApiRoute(
  'getAccountFitnessSummary',
  async (req: NextRequest, params: AppRouterParams<Params>) => {
    const database = getDatabase()
    if (!database) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Internal Server Error' },
        responseStatusCode: 500
      })
    }

    const session = await getServerAuthSession()
    if (!session?.user?.email) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unauthorized' },
        responseStatusCode: 401
      })
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Unauthorized' },
        responseStatusCode: 401
      })
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Bad Request' },
        responseStatusCode: 400
      })
    }
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Forbidden' },
        responseStatusCode: 403
      })
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsed = FitnessSummaryQueryParams.safeParse(queryParams)
    if (!parsed.success) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Bad Request' },
        responseStatusCode: 400
      })
    }

    const { start_date: startDate, end_date: endDate } = parsed.data
    if (endDate - startDate < MIN_DATE_RANGE_MS) {
      return apiResponse({
        req,
        allowedMethods: CORS_HEADERS,
        data: { error: 'Bad Request' },
        responseStatusCode: 400
      })
    }

    const summary = await database.getFitnessActivitySummary({
      actorId: id,
      startDate,
      endDate
    })

    return apiResponse({ req, allowedMethods: CORS_HEADERS, data: summary })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
