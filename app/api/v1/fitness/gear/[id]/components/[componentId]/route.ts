import { toGearComponentEntity } from '@/lib/services/fitness-gears/gearEntities'
import { UpdateGearComponentRequest } from '@/lib/services/fitness-gears/gearRequests'
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
    // against the stored other end — the same way the gear PATCH one directory
    // up validates its kind-scoped fields against the stored gear. Left to the
    // schema alone, `PATCH { removedAt }` earlier than the stored `addedAt`
    // writes a period no activity can ever fall inside: the component loses
    // that period's distance on every surface, permanently and silently,
    // behind a 200.
    //
    // Each bound must be checked against the other end OF THE PERIOD IT LANDS
    // ON. `addedAt` moves the FIRST period's start and `removedAt` the LAST
    // period's end, while the component's own `addedAt`/`removedAt` are derived
    // from those two DIFFERENT periods — so checking the request against that
    // derived pair compares bounds belonging to different periods the moment a
    // part has been refitted, and lets an inverting edit straight through. It
    // reads as correct because for a single-period component — every component
    // that has never been refitted — the first period and the last period are
    // the same row, and the two formulations coincide exactly.
    if ('addedAt' in parsed.data || 'removedAt' in parsed.data) {
      const components = await database.getFitnessGearComponents({
        gearId: id,
        actorId: currentActor.id
      })
      const existing = components.find(
        (candidate) => candidate.id === componentId
      )
      if (!existing) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

      // Both writes land on this one row when the component has a single
      // period, which is why the check is expressed per period rather than per
      // field: that case has to see BOTH new values, not one new and one stored.
      const lastIndex = existing.periods.length - 1
      const boundsAfterWrite = (index: number) => {
        const period = existing.periods[index]
        return {
          addedAt:
            index === 0 && 'addedAt' in parsed.data
              ? (parsed.data.addedAt ?? null)
              : (period.addedAt ?? null),
          removedAt:
            index === lastIndex && 'removedAt' in parsed.data
              ? (parsed.data.removedAt ?? null)
              : (period.removedAt ?? null)
        }
      }

      const inverted = [0, lastIndex]
        .filter((index) => index >= 0)
        .some((index) => {
          const { addedAt, removedAt } = boundsAfterWrite(index)
          return addedAt !== null && removedAt !== null && removedAt <= addedAt
        })

      if (inverted) {
        return apiResponse({
          req,
          allowedMethods: [],
          data: { error: 'removedAt must be after addedAt' },
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
