import { toGearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import {
  UpdateGearComponentRequest,
  getComponentPeriodBoundsError
} from '@/lib/services/fitness-gears/gearRequests'
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

export const PATCH = traceApiRoute(
  'updateFitnessGearComponent',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id, componentId } = (await params) ?? {
      id: undefined,
      componentId: undefined
    }
    if (!id || !componentId) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    let body: unknown
    try {
      body = await req.json()
    } catch (_error) {
      return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)
    }

    const parsed = UpdateGearComponentRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    const rejection = await rejectComponentsForDevice({
      req,
      database,
      actorId: currentActor.id,
      gearId: id
    })
    if (rejection) return rejection

    // The schema's own `removedAt > addedAt` rule can only see this request, so
    // a partial PATCH that moves one end of an install period has to be checked
    // against the stored other end — delegated to a named function beside the
    // schemas, the same way the gear PATCH one directory up hands its
    // kind-scoped fields to `getGearKindFieldError`. Which period each bound
    // lands on is the whole subtlety, and it is worth being able to test on its
    // own rather than only through this route.
    if ('addedAt' in parsed.data || 'removedAt' in parsed.data) {
      const components = await database.getFitnessGearComponents({
        gearId: id,
        actorId: currentActor.id
      })
      const existing = components.find(
        (candidate) => candidate.id === componentId
      )
      if (!existing) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

      // `parsed.data` is handed over whole rather than rebuilt: the schema's
      // `.nullish()` sits OUTERMOST, so a key absent from the body is absent
      // here too and an explicit null arrives present-and-null — which is
      // exactly the presence the check reads. Reconstructing that with
      // conditional spreads only restates it, and the fields it would leave out
      // are ones the check never looks at.
      const boundsError = getComponentPeriodBoundsError(
        existing.periods,
        parsed.data
      )
      if (boundsError) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: boundsError },
          responseStatusCode: 422
        })
      }
    }

    const component = await database.updateFitnessGearComponent({
      id: componentId,
      gearId: id,
      actorId: currentActor.id,
      componentType: parsed.data.componentType,
      ...('brand' in parsed.data ? { brand: parsed.data.brand } : {}),
      ...('model' in parsed.data ? { model: parsed.data.model } : {}),
      ...('addedAt' in parsed.data
        ? {
            addedAt: parsed.data.addedAt ? new Date(parsed.data.addedAt) : null
          }
        : {}),
      ...('removedAt' in parsed.data
        ? {
            removedAt: parsed.data.removedAt
              ? new Date(parsed.data.removedAt)
              : null
          }
        : {}),
      ...('serviceDistanceMeters' in parsed.data
        ? { serviceDistanceMeters: parsed.data.serviceDistanceMeters }
        : {})
    })
    if (!component) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const rollups = await database.getFitnessGearComponentDistanceRollups({
      actorId: currentActor.id,
      gearIds: [id]
    })

    return apiResponse({
      req,
      allowedMethods: [],
      data: {
        component: toGearComponentEntity(component, rollups[component.id])
      },
      responseStatusCode: 200
    })
  })
)

export const DELETE = traceApiRoute(
  'deleteFitnessGearComponent',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id, componentId } = (await params) ?? {
      id: undefined,
      componentId: undefined
    }
    if (!id || !componentId) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const rejection = await rejectComponentsForDevice({
      req,
      database,
      actorId: currentActor.id,
      gearId: id
    })
    if (rejection) return rejection

    const deleted = await database.deleteFitnessGearComponent({
      id: componentId,
      gearId: id,
      actorId: currentActor.id
    })
    if (!deleted) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    return apiResponse({
      req,
      allowedMethods: [],
      data: { success: true },
      responseStatusCode: 200
    })
  })
)
