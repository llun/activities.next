import { toGearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { RetireGearRequest } from '@/lib/services/fitness-gears/gearRequests'
import { getRollupForGear } from '@/lib/services/fitness-gears/gearRollups'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
}

/**
 * Retiring and unretiring are one idempotent toggle rather than two verbs:
 * `{ retired: false }` reads as clearly as a separate `/unretire` route and
 * halves the surface that has to stay in step.
 */
export const POST = traceApiRoute(
  'retireFitnessGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = RetireGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    // Loaded before the write so "not yours" stays a 404 and a device is
    // rejected without a state change. Retiring means "out of the pickers and
    // out of auto-assign", and a device is in neither: it is not something you
    // choose for an activity, it is what recorded it.
    const existing = await database.getFitnessGear({
      id,
      actorId: currentActor.id
    })
    if (!existing) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)
    if (existing.kind === 'device') {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: 'A recording device cannot be retired' },
        responseStatusCode: 422
      })
    }

    const gear = await database.setFitnessGearRetired({
      id,
      actorId: currentActor.id,
      retired: parsed.data.retired
    })
    if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const rollup = await getRollupForGear(database, currentActor.id, gear)

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGearEntity(gear, rollup) },
      responseStatusCode: 200
    })
  })
)
