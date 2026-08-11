import { toGearEntity } from '@/lib/services/fitness-gears/gearEntities'
import { RetireGearRequest } from '@/lib/services/fitness-gears/gearRequests'
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

    const gear = await database.setFitnessGearRetired({
      id,
      actorId: currentActor.id,
      retired: parsed.data.retired
    })
    if (!gear) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const rollups = await database.getFitnessGearDistanceRollups({
      actorId: currentActor.id,
      gearIds: [gear.id]
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: { gear: toGearEntity(gear, rollups[gear.id]) },
      responseStatusCode: 200
    })
  })
)
