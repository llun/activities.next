import { z } from 'zod'

import { FITNESS_RECORDS_RANGES } from '@/lib/fitness/bestEfforts'
import { getFitnessRecords } from '@/lib/services/fitness-files/personalRecords'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

const RecordsQuery = z.object({
  range: z.enum(FITNESS_RECORDS_RANGES).default('all')
})

/**
 * The signed-in actor's own records: per power duration and run distance, the
 * best value and the activity that holds it. There is no actor parameter, so
 * nobody can ask for anyone else's.
 */
export const GET = traceApiRoute(
  'getFitnessRecords',
  AuthenticatedGuard(async (req, context) => {
    const { currentActor, database } = context
    const parsed = RecordsQuery.safeParse({
      range: req.nextUrl.searchParams.get('range') ?? undefined
    })
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const records = await getFitnessRecords(database, {
      actorId: currentActor.id,
      range: parsed.data.range
    })
    return apiResponse({
      req,
      allowedMethods: [],
      data: records,
      responseStatusCode: 200
    })
  })
)
