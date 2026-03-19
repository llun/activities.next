import { getServerSession } from 'next-auth'
import { NextRequest } from 'next/server'
import { z } from 'zod'

import { getAuthOptions } from '@/app/api/auth/[...nextauth]/authOptions'
import { getDatabase } from '@/lib/database'
import { AppRouterParams } from '@/lib/services/guards/types'
import { getActorFromSession } from '@/lib/utils/getActorFromSession'
import { HttpMethod } from '@/lib/utils/getCORSHeaders'
import {
  apiErrorResponse,
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
      return apiErrorResponse(500)
    }

    const session = await getServerSession(getAuthOptions())
    if (!session?.user?.email) {
      return apiErrorResponse(401)
    }

    const currentActor = await getActorFromSession(database, session)
    if (!currentActor) {
      return apiErrorResponse(401)
    }

    const { id: encodedAccountId } = await params.params
    if (!encodedAccountId) {
      return apiErrorResponse(400)
    }
    const id = idToUrl(encodedAccountId)

    if (currentActor.id !== id) {
      return apiErrorResponse(403)
    }

    const url = new URL(req.url)
    const queryParams = Object.fromEntries(url.searchParams.entries())
    const parsed = FitnessSummaryQueryParams.safeParse(queryParams)
    if (!parsed.success) {
      return apiErrorResponse(400)
    }

    const { start_date: startDate, end_date: endDate } = parsed.data
    if (endDate - startDate < MIN_DATE_RANGE_MS) {
      return apiErrorResponse(400)
    }

    const summary = await database.getFitnessActivitySummary({
      actorId: id,
      startDate,
      endDate
    })

    return apiResponse({
      req,
      allowedMethods: CORS_HEADERS,
      data: summary
    })
  },
  {
    addAttributes: async (_req, context) => {
      const params = await context.params
      return { accountId: params?.id || 'unknown' }
    }
  }
)
