import { toGearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { rejectComponentsForDevice } from '@/lib/services/fitness-gears/gearRouteGuards'
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
 * Retiring a fitted part: closes its install window at today's date.
 *
 * The owner adds any successor part through `POST .../components` themselves.
 */
export const POST = traceApiRoute(
  'retireFitnessGearComponent',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id, componentId } = (await params) ?? {
      id: undefined,
      componentId: undefined
    }
    if (!id || !componentId) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    // The route consumes no body parameters (the owner adds any successor part
    // through POST .../components explicitly), but validates that a non-empty
    // payload is valid JSON so a malformed or truncated client request is rejected
    // with 400 rather than executing an unintended retirement.
    const text = await req.text()
    if (text.trim().length > 0) {
      try {
        JSON.parse(text)
      } catch (_error) {
        return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
      }
    }

    const rejection = await rejectComponentsForDevice({
      req,
      database,
      actorId: currentActor.id,
      gearId: id
    })
    if (rejection) return rejection

    const result = await database.retireFitnessGearComponent({
      id: componentId,
      gearId: id,
      actorId: currentActor.id
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
        component: toGearComponentEntity(result, rollups[result.id])
      },
      responseStatusCode: 200
    })
  })
)
