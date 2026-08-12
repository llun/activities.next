import { toGearEntity } from '@/lib/services/fitness-gears/gearEntities'
import {
  UpdateGearRequest,
  getGearKindFieldError
} from '@/lib/services/fitness-gears/gearRequests'
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

export const PATCH = traceApiRoute(
  'updateFitnessGear',
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

    const parsed = UpdateGearRequest.safeParse(body)
    if (!parsed.success) {
      return apiErrorResponse(HTTP_STATUS.UNPROCESSABLE_ENTITY)
    }

    // The body cannot carry `kind`, so the kind-scoped field rules are checked
    // against the stored gear. Loading it first also answers "not yours" as a
    // 404 before any validation detail leaks.
    const existing = await database.getFitnessGear({
      id,
      actorId: currentActor.id
    })
    if (!existing) return apiErrorResponse(HTTP_STATUS.NOT_FOUND)

    const fieldError = getGearKindFieldError(existing.kind, parsed.data)
    if (fieldError) {
      return apiResponse({
        req,
        allowedMethods: [],
        data: { error: fieldError },
        responseStatusCode: 422
      })
    }

    const gear = await database.updateFitnessGear({
      id,
      actorId: currentActor.id,
      ...parsed.data
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

export const DELETE = traceApiRoute(
  'deleteFitnessGear',
  AuthenticatedGuard<Params>(async (req, context) => {
    const { currentActor, database, params } = context
    const { id } = (await params) ?? { id: undefined }
    if (!id) return apiErrorResponse(HTTP_STATUS.BAD_REQUEST)

    const deleted = await database.deleteFitnessGear({
      id,
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
