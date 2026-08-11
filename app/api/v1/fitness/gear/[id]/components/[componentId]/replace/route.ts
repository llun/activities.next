import { toGearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { ReplaceGearComponentRequest } from '@/lib/services/fitness-gears/gearRequests'
import { AuthenticatedGuard } from '@/lib/services/guards/AuthenticatedGuard'
import {
  HTTP_STATUS,
  apiErrorResponse,
  apiResponse
} from '@/lib/utils/response'
import { traceApiRoute } from '@/lib/utils/traceApiRoute'

interface Params {
  id: string
  componentId: string
}

/**
 * Fitting a new part: closes the installed one at today's date and opens a
 * fresh row at 0 km carrying the same component type and service interval.
 *
 * This is one endpoint rather than a client-side PATCH-then-POST pair because
 * the two writes have to be atomic — a failure between them would leave the
 * bike with either no part of that type or two installed at once — and because
 * what the replacement inherits is a server-side rule.
 */
export const POST = traceApiRoute(
  'replaceFitnessGearComponent',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id, componentId } = (await params) ?? {
      id: undefined,
      componentId: undefined
    }
    if (!id || !componentId) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    // The body is optional: the design's Replace button sends nothing and the
    // owner fills in the new part's brand and model afterwards.
    const body: unknown = await req.json().catch(() => ({}))
    const parsed = ReplaceGearComponentRequest.safeParse(body ?? {})
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const result = await database.replaceFitnessGearComponent({
      id: componentId,
      gearId: id,
      actorId: currentActor.id,
      brand: parsed.data.brand,
      model: parsed.data.model
    })
    if (!result) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const rollups = await database.getFitnessGearComponentDistanceRollups({
      actorId: currentActor.id,
      gearIds: [id]
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        retired: toGearComponentEntity(
          result.retired,
          rollups[result.retired.id]
        ),
        replacement: toGearComponentEntity(
          result.replacement,
          rollups[result.replacement.id]
        )
      },
      responseStatusCode: 200
    })
  })
)
