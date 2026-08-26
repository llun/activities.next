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
 * Putting a retired part back on: opens a NEW install period starting today.
 *
 * Deliberately not the mirror of `/retire`, which would be reopening the window
 * that was closed. A component's periods are the record of when it was actually
 * fitted, and reopening the closed one credits the part every activity ridden
 * while it was off the bike — with no way back, since retiring again only closes
 * the window at the new today. A new period costs at most the gap between the
 * retirement and this request: seconds for a misclick, and the truth for a part
 * that really did spend a season on the shelf.
 *
 * A part that is already fitted answers 404, the same way `/retire` answers a
 * part that is already retired.
 */
export const POST = traceApiRoute(
  'refitFitnessGearComponent',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id, componentId } = (await params) ?? {
      id: undefined,
      componentId: undefined
    }
    if (!id || !componentId) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    // The route consumes no body parameters, but validates that a non-empty
    // payload is valid JSON so a malformed or truncated client request is
    // rejected with 400 rather than silently opening an install period.
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

    const result = await database.refitFitnessGearComponent({
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
